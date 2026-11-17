import { haversineKm, round, type HourlyTemp, type StationObservation } from '@spray/shared';
import { config } from '../config';
import { getJson } from '../http';

export const LVGMC_LABEL = 'LVĢMC';

export interface LvgmcStation { id: string; name: string; lat: number; lon: number }
/** Verified against the "Meteoroloģiskās stacijas" resource; used if that resource cannot be read. */
const FALLBACK_STATION: LvgmcStation = { id: 'RIPR99PA', name: 'Priekuļi', lat: 57.315556, lon: 25.338056 };

export interface LvgmcResult { observation: StationObservation | null; hourlyMinTemps: HourlyTemp[]; detail: string }

/** NB: in the stations resource GEOGR1 is longitude and GEOGR2 latitude. */
export function parseStations(records: any[]): LvgmcStation[] {
  return records
    .map((r) => ({ id: String(r.STATION_ID), name: String(r.NAME), lat: Number(r.GEOGR2), lon: Number(r.GEOGR1) }))
    .filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

export function nearestStation(stations: LvgmcStation[], lat: number, lon: number): LvgmcStation | null {
  let best: LvgmcStation | null = null;
  let bestD = Infinity;
  for (const s of stations) {
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/**
 * Long-format records {ABBREVIATION, DATETIME (UTC, no offset), VALUE} → latest observation + hourly minima.
 * TDRY/RLH/WNS10/WPGST/WNDD10 are values "during the observation time" (wind = 10-min mean);
 * HPRAB is the precipitation sum of the preceding hour; HATMN the hourly minimum temperature.
 */
export function parseObservations(records: any[], station: LvgmcStation, farm: { lat: number; lon: number }): LvgmcResult {
  const byTime = new Map<string, Record<string, number>>();
  for (const r of records) {
    if (r.VALUE === null || r.VALUE === undefined || r.VALUE === '') continue;
    const v = Number(r.VALUE);
    if (!Number.isFinite(v)) continue;
    const t = String(r.DATETIME);
    if (!byTime.has(t)) byTime.set(t, {});
    byTime.get(t)![String(r.ABBREVIATION)] = v;
  }
  const iso = (t: string) => new Date(Date.parse(t.replace(' ', 'T') + 'Z')).toISOString();
  const times = [...byTime.keys()].sort().reverse();
  const hourlyMinTemps: HourlyTemp[] = times
    .map((t) => ({ t: iso(t), temp: byTime.get(t)!.HATMN ?? byTime.get(t)!.TDRY ?? null, observed: true }))
    .filter((h) => h.temp !== null)
    .reverse();
  const latest = times.find((t) => byTime.get(t)!.TDRY !== undefined || byTime.get(t)!.WNS10 !== undefined);
  if (!latest) return { observation: null, hourlyMinTemps, detail: 'No current values for station' };
  const p = byTime.get(latest)!;
  const dir = p.WNDD10 ?? p.HWDAV;
  const observation: StationObservation = {
    source: 'lvgmc', sourceLabel: LVGMC_LABEL, stationId: station.id, station: station.name,
    lat: Number.isFinite(station.lat) ? station.lat : null, lon: Number.isFinite(station.lon) ? station.lon : null,
    distanceKm: Number.isFinite(station.lat) ? round(haversineKm(farm.lat, farm.lon, station.lat, station.lon), 1) : null,
    time: iso(latest),
    values: {
      temp: p.TDRY ?? p.HTDRY ?? null,
      rh: p.RLH ?? p.HRLH ?? null,
      wind: p.WNS10 ?? p.HWNDS ?? null,
      gust: p.WPGST ?? p.HWSMX ?? null,
      windDir: dir !== undefined && dir <= 360 ? dir : null, // 999 = variable
      precip: p.HPRAB ?? null,
    },
    note: 'hourly',
  };
  return { observation, hourlyMinTemps, detail: `${station.name} (${station.id})` };
}

let stationCache: { at: number; stations: LvgmcStation[] } | null = null;

export async function fetchLvgmc(): Promise<LvgmcResult> {
  let station: LvgmcStation | null = null;
  try {
    if (!stationCache || Date.now() - stationCache.at > 24 * 3600_000) {
      const j = await getJson(`${config.ckanBase}/datastore_search?resource_id=${config.lvgmc.stationsResource}&limit=500`);
      stationCache = { at: Date.now(), stations: parseStations(j.result.records) };
    }
    station = config.lvgmc.stationId
      ? stationCache.stations.find((s) => s.id === config.lvgmc.stationId) ?? null
      : nearestStation(stationCache.stations, config.farm.lat, config.farm.lon);
  } catch { /* station list is optional */ }
  station ??= config.lvgmc.stationId && config.lvgmc.stationId !== FALLBACK_STATION.id
    ? { id: config.lvgmc.stationId, name: config.lvgmc.stationId, lat: NaN, lon: NaN }
    : FALLBACK_STATION;
  const filters = encodeURIComponent(JSON.stringify({ STATION_ID: station.id }));
  const j = await getJson(`${config.ckanBase}/datastore_search?resource_id=${config.lvgmc.dataResource}&filters=${filters}&sort=${encodeURIComponent('DATETIME desc')}&limit=900`);
  if (!j.success) throw new Error(j.error?.message ?? 'CKAN error');
  return parseObservations(j.result.records, station, config.farm);
}
