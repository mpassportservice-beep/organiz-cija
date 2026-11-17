import type { ForecastSlot, HourlyTemp } from '@spray/shared';
import { config } from '../config';
import { getJson } from '../http';

export const OPEN_METEO_LABEL = 'Open-Meteo';
export const MODELS = [
  { id: 'ecmwf_ifs025', name: 'ECMWF IFS' },
  { id: 'icon_seamless', name: 'DWD ICON' },
];

export interface ForecastResult {
  slots: ForecastSlot[];
  hourlyTemps: HourlyTemp[];
  sunrise: string[];
  sunset: string[];
  models: string[];
}

const VARS = 'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m';

export function buildUrl(): string {
  const p = new URLSearchParams({
    latitude: String(config.farm.lat), longitude: String(config.farm.lon),
    minutely_15: VARS, hourly: `temperature_2m,precipitation_probability,cloud_cover`,
    daily: 'sunrise,sunset', models: MODELS.map((m) => m.id).join(','),
    wind_speed_unit: 'ms', timeformat: 'unixtime', timezone: 'UTC',
    past_hours: '24', forecast_hours: '40', past_minutely_15: '4', forecast_minutely_15: '104',
    forecast_days: '3',
  });
  return `${config.openMeteoBase}?${p}`;
}

type Agg = 'max' | 'min' | 'mean';
function combine(vals: (number | null | undefined)[], how: Agg): number | null {
  const v = vals.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  const r = how === 'max' ? Math.max(...v) : how === 'min' ? Math.min(...v) : v.reduce((a, b) => a + b, 0) / v.length;
  return Math.round(r * 10) / 10;
}
function meanDir(dirs: (number | null | undefined)[]): number | null {
  const v = dirs.filter((x): x is number => typeof x === 'number');
  if (!v.length) return null;
  const x = v.reduce((a, d) => a + Math.cos((d * Math.PI) / 180), 0);
  const y = v.reduce((a, d) => a + Math.sin((d * Math.PI) / 180), 0);
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/**
 * Merge the two models into one cautious forecast:
 * wind, gusts, precipitation amount and probability → the HIGHER of the two models;
 * cloud cover → the LOWER (clear sky is the risky case for inversions); hourly temperature → the LOWER (frost);
 * temperature, humidity, dew point → mean; wind direction → circular mean.
 * A model that returns nothing for a variable is simply left out.
 */
export function parseForecast(j: any): ForecastResult {
  const m15 = j.minutely_15;
  const hr = j.hourly;
  if (!m15?.time?.length || !hr?.time?.length) throw new Error('Forecast response has no time series');
  const present = MODELS.filter((m) => (m15[`temperature_2m_${m.id}`] ?? []).some((x: any) => x !== null));
  if (!present.length) throw new Error('No model returned data');
  const col = (sec: any, v: string, i: number) => present.map((m) => sec[`${v}_${m.id}`]?.[i] as number | null | undefined);

  const hourIdx = new Map<number, number>();
  hr.time.forEach((t: number, i: number) => hourIdx.set(t, i));

  const slots: ForecastSlot[] = m15.time.map((t: number, i: number) => {
    const hi = hourIdx.get(Math.floor(t / 3600) * 3600);
    // Open-Meteo precipitation is the sum of the PRECEDING interval: rain falling during [t, t+15) is at index i+1,
    // and the probability for hour [H, H+1) is at hourly index H+1.
    const hiNext = hourIdx.get(Math.floor(t / 3600) * 3600 + 3600);
    return {
      t: new Date(t * 1000).toISOString(),
      temp: combine(col(m15, 'temperature_2m', i), 'mean'),
      rh: combine(col(m15, 'relative_humidity_2m', i), 'mean'),
      dewPoint: combine(col(m15, 'dew_point_2m', i), 'mean'),
      wind: combine(col(m15, 'wind_speed_10m', i), 'max'),
      gust: combine(col(m15, 'wind_gusts_10m', i), 'max'),
      windDir: meanDir(col(m15, 'wind_direction_10m', i)),
      precip: i + 1 < m15.time.length ? combine(col(m15, 'precipitation', i + 1), 'max') : null,
      precipProb: hiNext !== undefined ? combine(col(hr, 'precipitation_probability', hiNext), 'max') : null,
      cloud: hi !== undefined ? combine(col(hr, 'cloud_cover', hi), 'min') : null,
    };
  });
  slots.pop(); // last slot has no precipitation value

  const hourlyTemps: HourlyTemp[] = hr.time.map((t: number, i: number) => ({
    t: new Date(t * 1000).toISOString(), temp: combine(col(hr, 'temperature_2m', i), 'min'), observed: false,
  }));
  const first = present[0].id;
  const iso = (a: number[] | undefined) => (a ?? []).filter((x) => x > 0).map((x) => new Date(x * 1000).toISOString());
  return {
    slots, hourlyTemps,
    sunrise: iso(j.daily?.[`sunrise_${first}`]), sunset: iso(j.daily?.[`sunset_${first}`]),
    models: present.map((m) => m.name),
  };
}

export async function fetchForecast(): Promise<ForecastResult> {
  const j = await getJson(buildUrl());
  if (j.error) throw new Error(j.reason ?? 'Open-Meteo error');
  return parseForecast(j);
}
