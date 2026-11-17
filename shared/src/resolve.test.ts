import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS as T } from './config';
import { bestWindow, buildTimeline, conditionsNow, nextGreenWindow, rainWindow, resolveVar, sunPhase, type TimelineSlot } from './resolve';
import type { ForecastSlot, Snapshot, StationObservation } from './types';

const NOW = Date.parse('2026-05-20T06:07:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const Q = 15 * 60_000;
const base = Date.parse('2026-05-20T05:00:00Z');

function slots(n: number, f: (i: number) => Partial<ForecastSlot> = () => ({})): ForecastSlot[] {
  return Array.from({ length: n }, (_, i) => ({
    t: iso(base + i * Q), temp: 15, rh: 65, dewPoint: 8, wind: 2, gust: 4, windDir: 180, precip: 0, precipProb: 0, cloud: 50, ...f(i),
  }));
}
function obs(source: 'lvc' | 'lvgmc', station: string, km: number, ageMin: number, values: StationObservation['values']): StationObservation {
  return { source, sourceLabel: source, stationId: station, station, lat: 57, lon: 25, distanceKm: km, time: iso(NOW - ageMin * 60_000), values };
}
function snap(observations: StationObservation[], s = slots(120)): Snapshot {
  return {
    generatedAt: iso(NOW), farm: { name: 'Priekuļi', lat: 57.315, lon: 25.355, timezone: 'Europe/Riga' }, observations,
    forecast: {
      sourceLabel: 'Open-Meteo', models: ['ECMWF IFS', 'DWD ICON'], fetchedAt: iso(NOW), slots: s,
      hourlyTemps: Array.from({ length: 60 }, (_, i) => ({ t: iso(base - 24 * 3600_000 + i * 3600_000), temp: 10, observed: false })),
      sunrise: ['2026-05-20T01:50:00Z', '2026-05-21T01:48:00Z'], sunset: ['2026-05-19T18:40:00Z', '2026-05-20T18:42:00Z'],
    },
    sources: [],
  };
}

describe('observation → forecast fallback', () => {
  it('uses the nearest fresh station', () => {
    const r = resolveVar(snap([obs('lvc', 'Near', 8, 5, { wind: 2.5 }), obs('lvgmc', 'Priekuļi', 1, 5, { wind: 4 })]), 'wind', NOW, 30)!;
    expect(r).toMatchObject({ value: 2.5, station: 'Near', distanceKm: 8, isForecast: false });
    expect(r.fallback).toBeUndefined();
  });
  it('skips a station that does not report the variable', () => {
    const r = resolveVar(snap([obs('lvc', 'Near', 8, 5, { wind: null }), obs('lvgmc', 'Priekuļi', 1, 10, { wind: 4 })]), 'wind', NOW, 30)!;
    expect(r.station).toBe('Priekuļi');
  });
  it('observation older than 30 min → stale → forecast, labelled, with the stale value attached', () => {
    const r = resolveVar(snap([obs('lvc', 'Near', 8, 31, { wind: 2.5 })]), 'wind', NOW, 30)!;
    expect(r).toMatchObject({ value: 2, isForecast: true, fallback: true, source: 'open-meteo', station: 'ECMWF IFS + DWD ICON' });
    expect(r.staleObservation).toMatchObject({ value: 2.5, station: 'Near', stale: true });
  });
  it('exactly 30 min old is still fresh', () => {
    expect(resolveVar(snap([obs('lvc', 'Near', 8, 30, { wind: 2.5 })]), 'wind', NOW, 30)!.isForecast).toBe(false);
  });
  it('a stale near station does not block a fresh farther one', () => {
    const r = resolveVar(snap([obs('lvc', 'Near', 8, 90, { temp: 1 }), obs('lvgmc', 'Priekuļi', 1, 12, { temp: 14 })]), 'temp', NOW, 30)!;
    expect(r).toMatchObject({ value: 14, station: 'Priekuļi', isForecast: false });
  });
  it('no observations at all → forecast fallback', () => {
    expect(resolveVar(snap([]), 'temp', NOW, 30)).toMatchObject({ value: 15, fallback: true });
  });
  it('no forecast either → recent stale observation, flagged stale', () => {
    const r = resolveVar(snap([obs('lvgmc', 'Priekuļi', 1, 50, { temp: 14 })], []), 'temp', NOW, 30)!;
    expect(r).toMatchObject({ value: 14, stale: true, isForecast: false });
  });
  it('nothing usable → null (engine then reports "no data", never green)', () => {
    expect(resolveVar(snap([obs('lvgmc', 'Priekuļi', 1, 400, { temp: 14 })], []), 'temp', NOW, 30)).toBeNull();
    expect(resolveVar(snap([], []), 'temp', NOW, 30)).toBeNull();
  });
  it('rejects timestamps far in the future (wrong timezone upstream)', () => {
    expect(resolveVar(snap([obs('lvc', 'Near', 8, -120, { wind: 2.5 })]), 'wind', NOW, 30)!.isForecast).toBe(true);
  });
  it('conditionsNow mixes sources per variable', () => {
    const c = conditionsNow(snap([obs('lvc', 'Near', 8, 5, { wind: 2.5, temp: 13 })]), NOW, T);
    expect(c.wind?.station).toBe('Near');
    expect(c.rh?.fallback).toBe(true);
    expect(c.cloud?.value).toBe(50);
    expect(c.minTempPast12).toBe(10);
  });
});

describe('rain windows', () => {
  it('sums mm and takes max probability over the window', () => {
    const s = slots(120, (i) => (i === 8 ? { precip: 0.4, precipProb: 70 } : i === 20 ? { precip: 1, precipProb: 90 } : {}));
    // slot 8 = 07:00, slot 20 = 10:00; now = 06:07
    expect(rainWindow(s, NOW, 1)).toEqual({ hours: 1, mm: 0.4, prob: 70 });
    expect(rainWindow(s, NOW, 2).mm).toBe(0.4);
    expect(rainWindow(s, NOW, 6)).toEqual({ hours: 6, mm: 1.4, prob: 90 });
  });
  it('no slots → nulls', () => expect(rainWindow([], NOW, 2)).toEqual({ hours: 2, mm: null, prob: null }));
});

describe('sun phase', () => {
  const s = snap([]);
  it('midday is day', () => expect(sunPhase(s, Date.parse('2026-05-20T10:00:00Z'), 90)).toMatchObject({ isNight: false, nearSunriseOrSunset: false }));
  it('after sunset is night', () => expect(sunPhase(s, Date.parse('2026-05-20T21:00:00Z'), 90).isNight).toBe(true));
  it('within margin after sunrise is "near"', () => expect(sunPhase(s, Date.parse('2026-05-20T02:30:00Z'), 90)).toMatchObject({ isNight: false, nearSunriseOrSunset: true }));
});

describe('timeline and best window', () => {
  it('produces 48 quarter-hour slots for 12 h starting at the current slot', () => {
    const tl = buildTimeline(snap([]), NOW, T);
    expect(tl).toHaveLength(48);
    expect(tl[0].t).toBe('2026-05-20T06:00:00.000Z');
    expect(tl.every((x) => x.flag === 'green')).toBe(true);
  });
  it('colours slots by the forecast and finds the longest green run', () => {
    // gusty until 08:00 (slot 12) and again from 15:00 (slot 40); rain 13:00–14:00 (slots 32–35) also blocks the 2 h before it
    const s = slots(120, (i) => ({ ...(i < 12 || i >= 40 ? { gust: 9 } : {}), ...(i >= 32 && i < 36 ? { precip: 0.5, precipProb: 80 } : {}) }));
    const tl = buildTimeline(snap([], s), NOW, T);
    expect(tl[0]).toMatchObject({ flag: 'red', checkId: 'gust' });
    const w = bestWindow(tl)!;
    expect(w).toMatchObject({ flag: 'green', start: '2026-05-20T08:00:00.000Z', end: '2026-05-20T11:15:00.000Z', minutes: 195 });
    expect(tl.find((x) => x.t === '2026-05-20T11:15:00.000Z')).toMatchObject({ flag: 'red', checkId: 'rain' });
  });
  it('falls back to the longest amber run when nothing is green', () => {
    const tl: TimelineSlot[] = slots(8).map((x, i) => ({ t: x.t, flag: i < 3 ? 'red' : 'amber', reason: null, checkId: null }));
    expect(bestWindow(tl)).toMatchObject({ flag: 'amber', minutes: 75 });
  });
  it('returns null when everything is red', () => {
    expect(bestWindow(slots(8).map((x) => ({ t: x.t, flag: 'red' as const, reason: null, checkId: null })))).toBeNull();
  });
  it('nextGreenWindow announces only future windows of ≥ 60 min, and nothing when already green', () => {
    const mk = (flags: string) => slots(flags.length).map((x, i) => ({ t: x.t, flag: ({ g: 'green', a: 'amber', r: 'red' } as const)[flags[i] as 'g'], reason: null, checkId: null }));
    const now = base + 60_000;
    expect(nextGreenWindow(mk('rrggrrgggggg'), now)).toMatchObject({ start: iso(base + 6 * Q), minutes: 90 });
    expect(nextGreenWindow(mk('ggggrrgggggg'), now)).toBeNull();
    expect(nextGreenWindow(mk('rrrrrrrr'), now)).toBeNull();
  });
});
