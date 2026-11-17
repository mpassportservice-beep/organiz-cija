export type Status = 'green' | 'amber' | 'red' | 'info';
export type Lang = 'lv' | 'en';

export type SourceId = 'lvc' | 'lvgmc' | 'open-meteo';

/** One measured or forecast value together with everything needed to attribute it. */
export interface Reading {
  value: number | null;
  source: SourceId;
  /** Human-readable source, e.g. "LVC ceļu meteostacija". */
  sourceLabel: string;
  /** Station name, or model name for forecasts. */
  station: string;
  /** Distance from farm in km (null for gridded forecast = farm location itself). */
  distanceKm: number | null;
  /** ISO timestamp the value is valid for. */
  time: string;
  isForecast: boolean;
  /** Observation older than the staleness limit, shown only because nothing better exists. */
  stale?: boolean;
  /** True when this is a forecast shown because the observation was stale/missing. */
  fallback?: boolean;
  /** The stale observation that was replaced, kept for display. */
  staleObservation?: Reading;
}

export type ObsVar = 'temp' | 'rh' | 'wind' | 'gust' | 'windDir' | 'precip' | 'dewPoint';

/** Latest observation from one station. */
export interface StationObservation {
  source: SourceId;
  sourceLabel: string;
  stationId: string;
  station: string;
  lat: number | null;
  lon: number | null;
  distanceKm: number | null;
  /** ISO time of the observation. */
  time: string;
  values: Partial<Record<ObsVar, number | null>>;
  /** Free-text notes, e.g. "wind = 10 min mean". */
  note?: string;
}

/** 15-minute forecast slot (merged ECMWF IFS + DWD ICON). */
export interface ForecastSlot {
  /** ISO start time of slot. */
  t: string;
  temp: number | null;
  rh: number | null;
  dewPoint: number | null;
  wind: number | null;
  gust: number | null;
  windDir: number | null;
  /** mm falling during this 15 min slot. */
  precip: number | null;
  /** % probability of precipitation in the hour containing this slot. */
  precipProb: number | null;
  cloud: number | null;
}

export interface HourlyTemp {
  t: string;
  temp: number | null;
  observed: boolean;
}

export interface SourceStatus {
  id: SourceId;
  label: string;
  ok: boolean;
  /** ISO time of last attempt. */
  attemptedAt: string | null;
  /** ISO time of last successful fetch. */
  fetchedAt: string | null;
  error: string | null;
  detail?: string;
}

export interface Snapshot {
  generatedAt: string;
  farm: { name: string; lat: number; lon: number; timezone: string };
  /** Observations ranked by priority: road stations by distance, then LVGMC. */
  observations: StationObservation[];
  forecast: {
    sourceLabel: string;
    models: string[];
    fetchedAt: string | null;
    slots: ForecastSlot[];
    /** Hourly temperatures -24h..+36h (observed where available, else model). */
    hourlyTemps: HourlyTemp[];
    /** ISO sunrise/sunset times covering yesterday..tomorrow. */
    sunrise: string[];
    sunset: string[];
  };
  sources: SourceStatus[];
}

export interface RainWindow {
  hours: number;
  prob: number | null;
  mm: number | null;
}

/** Everything the rules engine needs for one instant. */
export interface Conditions {
  time: string;
  temp: Reading | null;
  rh: Reading | null;
  dewPoint: Reading | null;
  wind: Reading | null;
  gust: Reading | null;
  windDir: Reading | null;
  precipNow: Reading | null;
  cloud: Reading | null;
  /** Rain outlook for 1 h, 2 h, 6 h. */
  rain: RainWindow[];
  /** Rain outlook over the required rain-free window. */
  rainRequired: RainWindow;
  rainSource: Reading | null;
  minTempPast12: number | null;
  minTempNext12: number | null;
  minTempPastWindow: number | null;
  minTempNextWindow: number | null;
  frostSource: string;
  /** Sun phase for inversion check. */
  sun: { isNight: boolean; nearSunriseOrSunset: boolean; sunrise: string | null; sunset: string | null };
}

export interface Product {
  id: string;
  name: string;
  minTemp: number | null;
  maxTemp: number | null;
  rainFreeHours: number | null;
  maxWind: number | null;
  beeHazard: boolean;
  phiDays: number | null;
  bbchMin: number | null;
  bbchMax: number | null;
  regNumber?: string;
  defaultDose?: string;
}

export interface CropSelection {
  cropId: string | null;
  bbch: number | null;
}

export type CheckId =
  | 'wind' | 'gust' | 'rain' | 'temp' | 'humidity' | 'deltaT' | 'inversion' | 'frost' | 'dew' | 'crop';

export interface CheckResult {
  id: CheckId;
  status: Status;
  /** Message key + params; render with formatReason(). */
  reason: { key: string; params?: Record<string, string | number> };
  /** Primary display value, already rounded, e.g. "3.2". */
  value: string | null;
  unit?: string;
  /** Readings behind this check (for source attribution). */
  readings: Reading[];
  /** True when the product profile changed the limits of this check. */
  productRule?: boolean;
}

export interface Evaluation {
  time: string;
  flag: Exclude<Status, 'info'>;
  /** The check that determined the flag (worst, first in list order). */
  decisive: CheckResult | null;
  checks: CheckResult[];
}
