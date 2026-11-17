import fs from 'node:fs';
import { haversineKm, round, type ObsVar, type StationObservation } from '@spray/shared';
import { config } from '../config';
import { getJson, parseTime } from '../http';

export const LVC_LABEL = 'LVC ceļu stacija';

export interface LvcStationRef { code?: string; name?: string; lat: number; lon: number }

/**
 * Column aliases. The short codes (AT, RH, DP, WS, WSM, WD, RI) are the ones LVC uses in its published
 * road-weather CSVs; the long names cover a human-readable variant of the live dataset.
 * Matching is case/diacritic-insensitive on the whole column name.
 */
const ALIASES: Record<string, string[]> = {
  stationId: ['stacija', 'stacijas kods', 'stacijas id', 'station', 'station id', 'station code', 'kods', 'code', 'id stacija'],
  stationName: ['nosaukums', 'stacijas nosaukums', 'stacijas vards', 'station name', 'name', 'vieta'],
  time: ['datums', 'laiks', 'datums un laiks', 'merijuma laiks', 'noverojuma laiks', 'time', 'datetime', 'timestamp', 'date'],
  lat: ['lat', 'latitude', 'platums', 'geogr platums', 'y'],
  lon: ['lon', 'lng', 'long', 'longitude', 'garums', 'geogr garums', 'x'],
  temp: ['at', 'gaisa temperatura', 'gaisa temp', 'air temperature', 'temperatura'],
  rh: ['rh', 'gaisa mitrums', 'relativais mitrums', 'mitrums', 'humidity', 'relative humidity'],
  dewPoint: ['dp', 'rasas punkts', 'dew point'],
  wind: ['ws', 'veja atrums', 'wind speed', 'videjais veja atrums'],
  gust: ['wsm', 'veja brazmas', 'brazmas', 'maksimalais veja atrums', 'max veja atrums', 'wind gust', 'wind speed max'],
  windDir: ['wd', 'veja virziens', 'wind direction'],
  precip: ['ri', 'nokrisnu intensitate', 'rain intensity', 'precipitation intensity', 'nokrisni'],
};

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export function mapColumns(fieldNames: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const normalized = fieldNames.map((f) => [f, norm(f)] as const);
  for (const [key, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const hit = normalized.find(([, n]) => n === a);
      if (hit) { out[key] = hit[0]; break; }
    }
  }
  return out;
}

/** LVC encodes "sensor missing" as 999 (or ±9999). */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || Math.abs(n) === 999 || Math.abs(n) >= 9999) return null;
  return n;
}

const RANGE: Record<ObsVar, [number, number]> = {
  temp: [-50, 50], rh: [0, 100], dewPoint: [-60, 40], wind: [0, 60], gust: [0, 80], windDir: [0, 360], precip: [0, 200],
};

export interface LvcParseResult { observations: StationObservation[]; detail: string }

/**
 * Wide-format records (one row per station per timestamp) → latest observation for the
 * `maxStations` nearest stations within `maxKm`, sorted by distance.
 * Station coordinates come from the row itself if present, else from the registry (lvc-stations.json).
 */
export function parseLvcRecords(
  fieldNames: string[], records: any[], registry: LvcStationRef[],
  farm: { lat: number; lon: number }, opts: { maxStations: number; maxKm: number; timezone: string },
): LvcParseResult {
  const col = mapColumns(fieldNames);
  if (!col.time || (!col.stationId && !col.stationName)) {
    return { observations: [], detail: `Unrecognised columns: ${fieldNames.slice(0, 12).join(', ')}` };
  }
  const latest = new Map<string, { t: number; row: any }>();
  for (const row of records) {
    const id = String(row[col.stationId ?? col.stationName!] ?? '').trim();
    const t = parseTime(row[col.time], opts.timezone);
    if (!id || Number.isNaN(t)) continue;
    const prev = latest.get(id);
    if (!prev || t > prev.t) latest.set(id, { t, row });
  }
  const out: StationObservation[] = [];
  let noCoords = 0;
  for (const [id, { t, row }] of latest) {
    const name = col.stationName ? String(row[col.stationName] ?? '').trim() : '';
    let lat = col.lat ? numOrNull(row[col.lat]) : null;
    let lon = col.lon ? numOrNull(row[col.lon]) : null;
    if (lat === null || lon === null || lat < 55 || lat > 59 || lon < 20 || lon > 29) {
      const ref = registry.find((r) =>
        (r.code && r.code.toLowerCase() === id.toLowerCase()) ||
        (r.name && name && norm(name).includes(norm(r.name))) ||
        (r.name && !col.stationName && norm(id).includes(norm(r.name))));
      lat = ref?.lat ?? null;
      lon = ref?.lon ?? null;
    }
    if (lat === null || lon === null) { noCoords++; continue; }
    const distanceKm = haversineKm(farm.lat, farm.lon, lat, lon);
    if (distanceKm > opts.maxKm) continue;
    const values: StationObservation['values'] = {};
    for (const v of Object.keys(RANGE) as ObsVar[]) {
      const n = col[v] ? numOrNull(row[col[v]!]) : null;
      values[v] = n !== null && n >= RANGE[v][0] && n <= RANGE[v][1] ? n : null;
    }
    out.push({
      source: 'lvc', sourceLabel: LVC_LABEL, stationId: id, station: name || id, lat, lon,
      distanceKm: round(distanceKm, 1), time: new Date(t).toISOString(), values,
    });
  }
  out.sort((a, b) => a.distanceKm! - b.distanceKm!);
  const detail = out.length
    ? `${latest.size} stations in feed`
    : noCoords
      ? `${latest.size} stations in feed, none with known coordinates within ${opts.maxKm} km – add them to lvc-stations.json`
      : `No station within ${opts.maxKm} km`;
  return { observations: out.slice(0, opts.maxStations), detail };
}

export function loadRegistry(): LvcStationRef[] {
  try {
    const j = JSON.parse(fs.readFileSync(config.lvc.stationsFile, 'utf8'));
    return (j.stations ?? []).filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  } catch { return []; }
}

let discovered: { at: number; ids: string[] } | null = null;

async function resourceIds(headers: Record<string, string>): Promise<string[]> {
  if (config.lvc.resourceId) return config.lvc.resourceId.split(',').map((s) => s.trim()).filter(Boolean);
  if (discovered && Date.now() - discovered.at < 6 * 3600_000) return discovered.ids;
  const j = await getJson(`${config.ckanBase}/package_show?id=${encodeURIComponent(config.lvc.dataset)}`, headers);
  const ids = (j.result?.resources ?? []).filter((r: any) => r.datastore_active).map((r: any) => String(r.id));
  if (!ids.length) throw new Error('Dataset has no datastore (REST) resource');
  discovered = { at: Date.now(), ids };
  return ids;
}

export async function fetchLvc(): Promise<LvcParseResult> {
  const headers: Record<string, string> = config.lvc.apiKey ? { Authorization: config.lvc.apiKey } : {};
  let ids: string[];
  try {
    ids = await resourceIds(headers);
  } catch (e: any) {
    throw new Error(`Dataset "${config.lvc.dataset}" not readable: ${e.message}`);
  }
  const registry = loadRegistry();
  let best: LvcParseResult = { observations: [], detail: 'No data' };
  for (const id of ids) {
    const j = await getJson(`${config.ckanBase}/datastore_search?resource_id=${id}&limit=3000`, headers);
    const fields = (j.result.fields ?? []).map((f: any) => String(f.id)).filter((f: string) => f !== '_id');
    const r = parseLvcRecords(fields, j.result.records ?? [], registry, config.farm, {
      maxStations: config.lvc.maxStations, maxKm: config.lvc.maxKm, timezone: config.lvc.timezone,
    });
    if (r.observations.length > best.observations.length || !best.observations.length) best = r;
  }
  if (!best.observations.length) throw new Error(best.detail);
  return best;
}
