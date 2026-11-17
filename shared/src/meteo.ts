/** Wet-bulb temperature (°C) from air temp (°C) and RH (%), Stull 2011 empirical fit. */
export function wetBulb(tempC: number, rh: number): number {
  const r = Math.min(100, Math.max(1, rh));
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) +
    Math.atan(tempC + r) -
    Math.atan(r - 1.676331) +
    0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) -
    4.686035
  );
}

/** Delta T = dry bulb − wet bulb (°C). Never negative. */
export function deltaT(tempC: number, rh: number): number {
  return Math.max(0, tempC - wetBulb(tempC, rh));
}

/** Dew point (°C) from temp + RH, Magnus formula. */
export function dewPoint(tempC: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const g = Math.log(Math.max(1, rh) / 100) + (a * tempC) / (b + tempC);
  return (b * g) / (a - g);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const COMPASS_LV = ['Z', 'ZA', 'A', 'DA', 'D', 'DR', 'R', 'ZR'];
const COMPASS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Index 0..7 of the 8-point compass sector for a bearing. */
export function sectorOf(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) / 45) % 8;
}

export function compass(deg: number, lang: 'lv' | 'en'): string {
  return (lang === 'lv' ? COMPASS_LV : COMPASS_EN)[sectorOf(deg)];
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
