import type { Thresholds } from './config';
import { evaluate } from './engine';
import type {
  CheckResult, Conditions, CropSelection, Evaluation, ForecastSlot, ObsVar, Product, RainWindow, Reading, Snapshot,
} from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
export const SLOT_MS = 15 * MIN;
/** A stale observation is still shown (flagged) if there is no forecast at all, but only up to this age. */
const MAX_STALE_USABLE_MS = 3 * HOUR;
/** Observations stamped slightly in the future (clock drift) are tolerated up to this. */
const FUTURE_TOLERANCE_MS = 10 * MIN;

const ms = (iso: string) => Date.parse(iso);

export function slotIndexAt(slots: ForecastSlot[], at: number): number {
  for (let i = 0; i < slots.length; i++) {
    const t = ms(slots[i].t);
    if (at >= t && at < t + SLOT_MS) return i;
  }
  return -1;
}

function forecastReading(snap: Snapshot, slot: ForecastSlot, value: number | null, fallback: boolean): Reading {
  return {
    value,
    source: 'open-meteo',
    sourceLabel: snap.forecast.sourceLabel,
    station: snap.forecast.models.join(' + '),
    distanceKm: 0,
    time: slot.t,
    isForecast: true,
    fallback,
  };
}

const SLOT_KEY: Record<ObsVar, keyof ForecastSlot> = {
  temp: 'temp', rh: 'rh', wind: 'wind', gust: 'gust', windDir: 'windDir', precip: 'precip', dewPoint: 'dewPoint',
};

/**
 * Pick the value for one variable at "now":
 * 1. the first station (ranked by priority/distance) with a fresh observation;
 * 2. otherwise the forecast, labelled as fallback and carrying the stale observation for display;
 * 3. otherwise a stale observation (≤ 3 h old), flagged stale;
 * 4. otherwise null.
 */
export function resolveVar(snap: Snapshot, v: ObsVar, now: number, staleMinutes: number): Reading | null {
  let stale: Reading | undefined;
  for (const o of snap.observations) {
    const value = o.values[v];
    if (value === null || value === undefined) continue;
    const age = now - ms(o.time);
    const r: Reading = {
      value, source: o.source, sourceLabel: o.sourceLabel, station: o.station,
      distanceKm: o.distanceKm, time: o.time, isForecast: false,
    };
    if (age <= staleMinutes * MIN && age >= -FUTURE_TOLERANCE_MS) return r;
    if (!stale) stale = { ...r, stale: true };
  }
  const i = slotIndexAt(snap.forecast.slots, now);
  if (i >= 0) {
    const slot = snap.forecast.slots[i];
    let value = slot[SLOT_KEY[v]] as number | null;
    if (v === 'precip' && value !== null) value = value * 4; // 15-min sum → mm/h rate
    if (value !== null) return { ...forecastReading(snap, slot, value, true), staleObservation: stale };
  }
  if (stale && now - ms(stale.time) <= MAX_STALE_USABLE_MS) return stale;
  return null;
}

export function rainWindow(slots: ForecastSlot[], from: number, hours: number): RainWindow {
  let mm: number | null = null;
  let prob: number | null = null;
  const start = Math.floor(from / SLOT_MS) * SLOT_MS;
  const end = from + hours * HOUR;
  for (const s of slots) {
    const t = ms(s.t);
    if (t < start || t >= end) continue;
    if (s.precip !== null) mm = (mm ?? 0) + s.precip;
    if (s.precipProb !== null) prob = Math.max(prob ?? 0, s.precipProb);
  }
  return { hours, mm: mm === null ? null : Math.round(mm * 100) / 100, prob };
}

function minTemp(snap: Snapshot, from: number, to: number): number | null {
  let m: number | null = null;
  for (const h of snap.forecast.hourlyTemps) {
    const t = ms(h.t);
    if (t < from || t > to || h.temp === null) continue;
    m = m === null ? h.temp : Math.min(m, h.temp);
  }
  return m;
}

export function sunPhase(snap: Snapshot, at: number, marginMin: number): Conditions['sun'] {
  const rises = snap.forecast.sunrise.map(ms);
  const sets = snap.forecast.sunset.map(ms);
  let isNight = true;
  for (const r of rises) {
    const s = sets.find((x) => x > r && x - r < 24 * HOUR);
    if (s !== undefined && at >= r && at <= s) isNight = false;
  }
  const m = marginMin * MIN;
  const near = [...rises, ...sets].some((x) => Math.abs(at - x) <= m);
  const nextRise = rises.find((x) => x > at) ?? null;
  const nextSet = sets.find((x) => x > at) ?? null;
  return {
    isNight: rises.length === 0 ? false : isNight,
    nearSunriseOrSunset: near,
    sunrise: nextRise ? new Date(nextRise).toISOString() : null,
    sunset: nextSet ? new Date(nextSet).toISOString() : null,
  };
}

function commonParts(snap: Snapshot, at: number, t: Thresholds, rainHours: number) {
  const slots = snap.forecast.slots;
  const i = slotIndexAt(slots, at);
  const slot = i >= 0 ? slots[i] : null;
  const fw = t.frostWindowHours * HOUR;
  return {
    slot,
    rain: [1, 2, 6].map((h) => rainWindow(slots, at, h)),
    rainRequired: rainWindow(slots, at, rainHours),
    rainSource: slot ? forecastReading(snap, slot, null, false) : null,
    cloud: slot && slot.cloud !== null ? forecastReading(snap, slot, slot.cloud, false) : null,
    minTempPast12: minTemp(snap, at - 12 * HOUR, at),
    minTempNext12: minTemp(snap, at, at + 12 * HOUR),
    minTempPastWindow: minTemp(snap, at - fw, at),
    minTempNextWindow: minTemp(snap, at, at + fw),
    frostSource: snap.forecast.hourlyTemps.some((h) => h.observed) ? 'obs+forecast' : 'forecast',
    sun: sunPhase(snap, at, t.inversionSunMarginMin),
  };
}

/** Conditions right now: observations where fresh, forecast otherwise. */
export function conditionsNow(snap: Snapshot, now: number, t: Thresholds, product?: Product | null): Conditions {
  const rainHours = product?.rainFreeHours ?? t.rainFreeHours;
  const { slot: _slot, ...parts } = commonParts(snap, now, t, rainHours);
  const pick = (v: ObsVar) => resolveVar(snap, v, now, t.staleMinutes);
  return {
    time: new Date(now).toISOString(),
    temp: pick('temp'), rh: pick('rh'), dewPoint: pick('dewPoint'), wind: pick('wind'), gust: pick('gust'),
    windDir: pick('windDir'), precipNow: pick('precip'),
    ...parts,
  };
}

/** Conditions for a future 15-min slot: forecast only. */
export function conditionsAtSlot(snap: Snapshot, slot: ForecastSlot, t: Thresholds, product?: Product | null): Conditions {
  const at = ms(slot.t);
  const rainHours = product?.rainFreeHours ?? t.rainFreeHours;
  const { slot: _s, ...parts } = commonParts(snap, at, t, rainHours);
  const r = (v: number | null) => (v === null ? null : forecastReading(snap, slot, v, false));
  return {
    time: slot.t,
    temp: r(slot.temp), rh: r(slot.rh), dewPoint: r(slot.dewPoint), wind: r(slot.wind), gust: r(slot.gust),
    windDir: r(slot.windDir), precipNow: null,
    ...parts,
  };
}

export interface TimelineSlot {
  t: string;
  flag: Evaluation['flag'];
  reason: CheckResult['reason'] | null;
  checkId: string | null;
}

/** 12-hour colour bar: one evaluation per 15 minutes, starting with the slot containing `now`. */
export function buildTimeline(
  snap: Snapshot, now: number, t: Thresholds, product?: Product | null, crop?: CropSelection | null, hours = 12,
): TimelineSlot[] {
  const start = Math.floor(now / SLOT_MS) * SLOT_MS;
  const end = start + hours * HOUR;
  const out: TimelineSlot[] = [];
  for (const slot of snap.forecast.slots) {
    const st = ms(slot.t);
    if (st < start || st >= end) continue;
    const ev = evaluate(conditionsAtSlot(snap, slot, t, product), t, product, crop);
    out.push({ t: slot.t, flag: ev.flag, reason: ev.decisive?.reason ?? null, checkId: ev.decisive?.id ?? null });
  }
  return out;
}

export interface Window {
  start: string;
  end: string;
  flag: 'green' | 'amber';
  minutes: number;
}

function runs(tl: TimelineSlot[], flag: 'green' | 'amber'): Window[] {
  const out: Window[] = [];
  let i = 0;
  while (i < tl.length) {
    if (tl[i].flag !== flag) { i++; continue; }
    let j = i;
    while (j + 1 < tl.length && tl[j + 1].flag === flag && ms(tl[j + 1].t) - ms(tl[j].t) === SLOT_MS) j++;
    const start = ms(tl[i].t);
    const end = ms(tl[j].t) + SLOT_MS;
    out.push({ start: tl[i].t, end: new Date(end).toISOString(), flag, minutes: (end - start) / MIN });
    i = j + 1;
  }
  return out;
}

/** Longest green run (earliest on ties); if there is no green at all, the longest amber run. */
export function bestWindow(tl: TimelineSlot[], minMinutes = 30): Window | null {
  for (const flag of ['green', 'amber'] as const) {
    const r = runs(tl, flag).filter((w) => w.minutes >= minMinutes);
    if (r.length) return r.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  }
  return null;
}

/** First green window that starts in the future (used for the "a green window opens at…" push). */
export function nextGreenWindow(tl: TimelineSlot[], now: number, minMinutes = 60): Window | null {
  if (!tl.length || tl[0].flag === 'green') return null; // already green: nothing to announce
  return runs(tl, 'green').find((w) => ms(w.start) > now && w.minutes >= minMinutes) ?? null;
}
