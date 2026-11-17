import type { HourlyTemp, Snapshot, SourceStatus, StationObservation } from '@spray/shared';
import { kvGet, kvSet, sourceFail, sourceGet, sourceOk } from './db';
import { currentFarm, farmKey, type Farm } from './farm';
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

/** Cached payload, but only if it was fetched for this location (never show another place's weather). */
function forFarm<T>(id: 'lvc' | 'lvgmc' | 'open-meteo', key: string) {
  const r = sourceGet<Keyed<T>>(id);
  return r.payload && r.payload.farmKey === key ? r : { ...r, payload: null, fetchedAt: null };
}

/** Build the snapshot purely from the cache, so a failing source degrades to its last good data. */
export function assembleSnapshot(farm: Farm = currentFarm()): Snapshot {
  const key = farmKey(farm);
  const lvc = forFarm<LvcParseResult>('lvc', key);
  const lvgmc = forFarm<LvgmcResult>('lvgmc', key);
  const om = forFarm<ForecastResult>('open-meteo', key);
  const observations: StationObservation[] = [
    ...(lvc.payload?.observations ?? []),
    ...(lvgmc.payload?.observation ? [lvgmc.payload.observation] : []),
  ];
  const sources: SourceStatus[] = SOURCES.map((s) => {
    const r = sourceGet<unknown>(s.id);
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

let running: Promise<Snapshot> | null = null;
let runningKey = '';
let lastRun = 0;
let lastKey = '';

/** Fetch all sources (independently — one failing never blocks the others), cache, and rebuild the snapshot. */
export function refreshAll(log: (msg: string) => void = () => {}): Promise<Snapshot> {
  const farm = currentFarm();
  const key = farmKey(farm);
  if (running && runningKey === key) return running;
  // The location changed while a fetch for the old one was running: fetch again for the new one afterwards.
  if (running) return running.then(() => refreshAll(log), () => refreshAll(log));
  runningKey = key;
  running = (async () => {
    await Promise.all(SOURCES.map(async (s) => {
      try {
        const r = await (s.run as (f: Farm) => Promise<any>)(farm);
        sourceOk(s.id, { ...r, farmKey: key }, (s.detail as (x: any) => string)(r));
      } catch (e: any) {
        sourceFail(s.id, String(e?.message ?? e).slice(0, 300));
        log(`[fetch] ${s.id} failed: ${e?.message ?? e}`);
      }
    }));
    lastRun = Date.now();
    lastKey = key;
    const snap = assembleSnapshot(farm);
    kvSet('snapshot', snap);
    return snap;
  })().finally(() => { running = null; });
  return running;
}

export function currentSnapshot(): Snapshot {
  const snap = kvGet<Snapshot>('snapshot');
  return snap && farmKey(snap.farm) === farmKey(currentFarm()) ? snap : assembleSnapshot();
}
export const msSinceLastRun = () => Date.now() - lastRun;
/** True when the last fetch was for a different location than the one now chosen. */
export const locationChanged = () => lastKey !== farmKey(currentFarm());
