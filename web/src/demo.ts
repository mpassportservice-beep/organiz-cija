/**
 * Demo build only (VITE_DEMO=1): the app runs without a backend, e.g. as a hosted preview page.
 * The real server is replaced by a recorded snapshot whose timestamps are moved to "now",
 * plus an invented good-day scenario. Never used in the normal build.
 */
import type { LogRecord, Snapshot } from '@spray/shared';
import recorded from './demo-snapshot.json';

export const DEMO = !!import.meta.env.VITE_DEMO;
export type Scenario = 'sample' | 'recorded';
export const RECORDED_AT = (recorded as Snapshot).generatedAt;

let scenario: Scenario = 'sample';
export const getScenario = () => scenario;
export const setScenario = (s: Scenario) => { scenario = s; };

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;
function shift<T>(v: T, delta: number): T {
  if (typeof v === 'string') return (ISO.test(v) ? new Date(Date.parse(v) + delta).toISOString() : v) as T;
  if (Array.isArray(v)) return v.map((x) => shift(x, delta)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x, delta)])) as T;
  return v;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const H = 3_600_000;

function recordedNow(): Snapshot {
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  // Whole quarter-hours, so forecast slots stay on :00/:15/:30/:45.
  const q = 15 * 60_000;
  const delta = Math.round((now - Date.parse(RECORDED_AT)) / q) * q;
  return { ...shift(recorded as Snapshot, delta), generatedAt: new Date(now).toISOString() };
}

/** Invented mild morning: green now, wind picks up after ~3.5 h, a shower after ~8 h. */
function sampleNow(): Snapshot {
  const base = recordedNow();
  const now = Date.parse(base.generatedAt);
  const wave = (h: number) => Math.sin((Math.PI * (h + 1)) / 12);
  const slots = base.forecast.slots.map((s) => {
    const h = (Date.parse(s.t) - now) / H;
    const temp = r1(13 + 5 * wave(h));
    const rh = Math.round(70 - 18 * wave(h));
    const wind = r1(h >= 5.5 && h < 6.5 ? 5.6 : h >= 3.5 && h < 5.5 ? 4.2 : 2.4 + 0.3 * Math.sin(h * 2));
    const wet = h >= 8 && h < 9.5;
    return {
      ...s, temp, rh, dewPoint: r1(temp - (100 - rh) / 5), wind, gust: r1(wind * 1.6), windDir: 230,
      precip: wet ? 0.3 : 0, precipProb: wet ? 80 : h >= 6.5 && h < 8 ? 40 : 5, cloud: 55,
    };
  });
  const day = [-24, 0, 24];
  return {
    ...base,
    observations: [{
      source: 'lvgmc', sourceLabel: 'LVĢMC', stationId: 'RIPR99PA', station: 'Priekuļi', lat: 57.315556, lon: 25.338056, distanceKm: 1,
      time: new Date(now - 14 * 60_000).toISOString(),
      values: { temp: 14.2, rh: 67, wind: 2.4, gust: 3.9, windDir: 230, precip: 0 }, note: 'hourly',
    }],
    forecast: {
      ...base.forecast, slots,
      hourlyTemps: base.forecast.hourlyTemps.map((x) => { const h = (Date.parse(x.t) - now) / H; return { ...x, temp: r1(12 + 5 * wave(h)), observed: h <= 0 }; }),
      sunrise: day.map((d) => new Date(now + (d - 3) * H).toISOString()),
      sunset: day.map((d) => new Date(now + (d + 11) * H).toISOString()),
    },
  };
}

let memLogs: LogRecord[] = [];
const LOGS_KEY = 'spray.demoLogs';
function loadLogs(): LogRecord[] {
  try { const v = localStorage.getItem(LOGS_KEY); if (v) memLogs = JSON.parse(v) as LogRecord[]; } catch { /* storage unavailable */ }
  return memLogs;
}

export async function demoApi(path: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method ?? 'GET';
  if (path === '/api/snapshot' || path === '/api/refresh') return scenario === 'sample' ? sampleNow() : recordedNow();
  if (path === '/api/state' && method === 'PUT') return { ok: true };
  if (path === '/api/logs' && method === 'GET') return loadLogs();
  if (path === '/api/logs' && method === 'POST') {
    const rec = JSON.parse(String(init?.body)) as LogRecord;
    memLogs = [rec, ...loadLogs().filter((x) => x.id !== rec.id)];
    try { localStorage.setItem(LOGS_KEY, JSON.stringify(memLogs)); } catch { /* storage unavailable */ }
    return { ok: true };
  }
  throw new Error('not available in demo');
}
