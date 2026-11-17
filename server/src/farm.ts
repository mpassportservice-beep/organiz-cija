import type { AppState } from '@spray/shared';
import { config } from './config';

export interface Farm { name: string; lat: number; lon: number; timezone: string }

/** Where a farm's weather comes from: its chosen location, else the configured default point. */
export function farmLocation(state: AppState): Farm {
  const loc = state.location;
  return loc
    ? { name: loc.name || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`, lat: loc.lat, lon: loc.lon, timezone: config.farm.timezone }
    : config.farm;
}

/** Weather is fetched and cached per location; farms at the same point share it. */
export const farmKey = (f: { lat: number; lon: number }) => `${f.lat.toFixed(4)},${f.lon.toFixed(4)}`;
