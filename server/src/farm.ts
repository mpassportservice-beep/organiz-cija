import { normalizeState } from '@spray/shared';
import { config } from './config';
import { kvGet } from './db';

export interface Farm { name: string; lat: number; lon: number; timezone: string }

/** The location chosen in the app (saved settings), else the configured default farm. */
export function currentFarm(): Farm {
  const loc = normalizeState(kvGet('state')).location;
  return loc ? { name: loc.name || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`, lat: loc.lat, lon: loc.lon, timezone: config.farm.timezone } : config.farm;
}

/** Cached source data is only valid for the coordinates it was fetched for. */
export const farmKey = (f: { lat: number; lon: number }) => `${f.lat.toFixed(4)},${f.lon.toFixed(4)}`;
