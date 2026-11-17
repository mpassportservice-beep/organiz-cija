import type { HourlyTemp, Snapshot, SourceStatus, StationObservation } from '@spray/shared';
import { kvGet, kvSet, sourceFail, sourceGet, sourceOk } from './db';
import { farmKey, type Farm } from './farm';
import { fetchLvc, LVC_LABEL, type LvcParseResult } from './sources/lvc';
import { fetchLvgmc, LVGMC_LABEL, type LvgmcResult } from './sources/lvgmc';
import { fetchForecast, OPEN_METEO_LABEL, type ForecastResult } from './sources/openMeteo';

const SOURCES = [
  { id: 'lvc' as const, label: LVC_LABEL, run: fetchLvc, detail: (r: LvcParseResult) => r.detail },
  { id: 'lvgmc' as const, label: LVGMC_LABEL, run: fetchLvgmc, detail: (r: LvgmcResult) => r.detail },
  { id: 'open-meteo' as const, label: OPEN_METEO_LABEL, run: fetchForecast, detail: (r: ForecastResult) => r.models.join(' + ') },
];

/** Observed hourly minima replace model temperatures for the same hour (frost check uses real data where it exists). */
export function mergeHourlyTemps(model: HourlyTemp[], observed: HourlyTemp[]): HourlyTemp[] {
  const obs = new Map(observed.map((h) => [h.t, h]));
  const out = model.map((h) => obs.get(h.t) ?? h);
  const have = new Set(out.map((h) => h.t));
  for (const h of observed) if (!have.has(h.t)) out.push(h);
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

type Keyed<T> = T & { farmKey?: string };

/** Source data is cached per location: "open-meteo@57.3150,25.3550". */
const cacheKey = (id: string, key: string) => `${id}@${key}`;

/** Cached payload, but only if it was fetched for this location (never show another place's weather). */
function forFarm<T>(id: 'lvc' | 'lvgmc' | 'open-meteo', key: string) {
  const r = sourceGet<Keyed<T>>(cacheKey(id, key));
  return r.payload && r.payload.farmKey === key ? r : { ...r, payload: null, fetchedAt: null };
}

/** Build the snapshot purely from the cache, so a failing source degrades to its last good data. */
export function assembleSnapshot(farm: Farm): Snapshot {
  const key = farmKey(farm);
  const lvc = forFarm<LvcParseResult>('lvc', key);
  const lvgmc = forFarm<LvgmcResult>('lvgmc', key);
  const om = forFarm<ForecastResult>('open-meteo', key);
  const observations: StationObservation[] = [
    ...(lvc.payload?.observations ?? []),
    ...(lvgmc.payload?.observation ? [lvgmc.payload.observation] : []),
  ];
  const sources: SourceStatus[] = SOURCES.map((s) => {
    const r = sourceGet<unknown>(cacheKey(s.id, key));
    return { id: s.id, label: s.label, ok: r.ok, attemptedAt: r.attemptedAt, fetchedAt: r.fetchedAt, error: r.error, detail: r.detail ?? undefined };
  });
  return {
    generatedAt: new Date().toISOString(),
    farm: { name: farm.name, lat: farm.lat, lon: farm.lon, timezone: farm.timezone },
    observations,
    forecast: {
      sourceLabel: OPEN_METEO_LABEL,
      models: om.payload?.models ?? [],
      fetchedAt: om.fetchedAt,
      slots: om.payload?.slots ?? [],
      hourlyTemps: mergeHourlyTemps(om.payload?.hourlyTemps ?? [], lvgmc.payload?.hourlyMinTemps ?? []),
      sunrise: om.payload?.sunrise ?? [],
      sunset: om.payload?.sunset ?? [],
    },
    sources,
  };
}

const running = new Map<string, Promise<Snapshot>>();
const lastRun = new Map<string, number>();

/** Fetch all sources for one location (independently — one failing never blocks the others), cache, rebuild. */
export function refreshAll(farm: Farm, log: (msg: string) => void = () => {}): Promise<Snapshot> {
  const key = farmKey(farm);
  const busy = running.get(key);
  if (busy) return busy;
  const job = (async () => {
    await Promise.all(SOURCES.map(async (s) => {
      try {
        const r = await (s.run as (f: Farm) => Promise<any>)(farm);
        sourceOk(cacheKey(s.id, key), { ...r, farmKey: key }, (s.detail as (x: any) => string)(r));
      } catch (e: any) {
        sourceFail(cacheKey(s.id, key), String(e?.message ?? e).slice(0, 300));
        log(`[fetch] ${s.id} @ ${key} failed: ${e?.message ?? e}`);
      }
    }));
    lastRun.set(key, Date.now());
    const snap = assembleSnapshot(farm);
    kvSet(`snapshot@${key}`, snap);
    return snap;
  })().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

/** Latest snapshot for a location, named after the farm's place; null if it has never been fetched. */
export function cachedSnapshot(farm: Farm): Snapshot | null {
  const snap = kvGet<Snapshot>(`snapshot@${farmKey(farm)}`);
  return snap ? { ...snap, farm: { ...snap.farm, name: farm.name } } : null;
}
export const msSinceLastRun = (farm: Farm) => Date.now() - (lastRun.get(farmKey(farm)) ?? 0);
