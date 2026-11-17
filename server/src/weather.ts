import type { HourlyTemp, Snapshot, SourceStatus, StationObservation } from '@spray/shared';
import { config } from './config';
import { kvGet, kvSet, sourceFail, sourceGet, sourceOk } from './db';
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

/** Build the snapshot purely from the cache, so a failing source degrades to its last good data. */
export function assembleSnapshot(): Snapshot {
  const lvc = sourceGet<LvcParseResult>('lvc');
  const lvgmc = sourceGet<LvgmcResult>('lvgmc');
  const om = sourceGet<ForecastResult>('open-meteo');
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
    farm: config.farm,
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
let lastRun = 0;

/** Fetch all sources (independently — one failing never blocks the others), cache, and rebuild the snapshot. */
export function refreshAll(log: (msg: string) => void = () => {}): Promise<Snapshot> {
  if (running) return running;
  running = (async () => {
    await Promise.all(SOURCES.map(async (s) => {
      try {
        const r = await (s.run as () => Promise<any>)();
        sourceOk(s.id, r, (s.detail as (x: any) => string)(r));
      } catch (e: any) {
        sourceFail(s.id, String(e?.message ?? e).slice(0, 300));
        log(`[fetch] ${s.id} failed: ${e?.message ?? e}`);
      }
    }));
    lastRun = Date.now();
    const snap = assembleSnapshot();
    kvSet('snapshot', snap);
    return snap;
  })().finally(() => { running = null; });
  return running;
}

export function currentSnapshot(): Snapshot {
  return kvGet<Snapshot>('snapshot') ?? assembleSnapshot();
}
export const msSinceLastRun = () => Date.now() - lastRun;
