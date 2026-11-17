import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, mergeThresholds } from './config';
import { evaluate } from './engine';
import { deltaT, dewPoint, wetBulb } from './meteo';
import { formatReason } from './messages';
import type { Conditions, Product, Reading } from './types';

const T = DEFAULT_THRESHOLDS;
const r = (value: number | null): Reading => ({
  value, source: 'lvc', sourceLabel: 'LVC', station: 'Test', distanceKm: 5, time: '2026-05-20T06:00:00.000Z', isForecast: false,
});

/** Ideal spraying weather: every check green. */
function ideal(over: Partial<Conditions> = {}): Conditions {
  return {
    time: '2026-05-20T06:00:00.000Z',
    temp: r(15), rh: r(65), dewPoint: r(8.5), wind: r(2), gust: r(4), windDir: r(200), precipNow: r(0), cloud: r(60),
    rain: [{ hours: 1, prob: 0, mm: 0 }, { hours: 2, prob: 5, mm: 0 }, { hours: 6, prob: 10, mm: 0 }],
    rainRequired: { hours: 2, prob: 5, mm: 0 }, rainSource: null,
    minTempPast12: 7, minTempNext12: 9, minTempPastWindow: 6, minTempNextWindow: 8, frostSource: 'forecast',
    sun: { isNight: false, nearSunriseOrSunset: false, sunrise: null, sunset: null },
    ...over,
  };
}
const status = (c: Conditions, id: string, p?: Product | null, crop?: any, t = T) =>
  evaluate(c, t, p, crop).checks.find((x) => x.id === id)!.status;
const product = (over: Partial<Product> = {}): Product => ({
  id: 'p', name: 'TestProd', minTemp: null, maxTemp: null, rainFreeHours: null, maxWind: null, beeHazard: false,
  phiDays: null, bbchMin: null, bbchMax: null, ...over,
});

describe('meteo', () => {
  it('wet bulb matches Stull reference point (20 °C, 50 % → 13.7 °C)', () => {
    expect(wetBulb(20, 50)).toBeCloseTo(13.7, 1);
  });
  it('delta T is ~0 at saturation and grows as air dries', () => {
    expect(deltaT(15, 100)).toBeLessThan(0.3);
    expect(deltaT(25, 30)).toBeGreaterThan(10);
    expect(deltaT(20, 50)).toBeCloseTo(6.3, 1);
  });
  it('dew point (20 °C, 50 % → 9.3 °C)', () => expect(dewPoint(20, 50)).toBeCloseTo(9.3, 1));
});

describe('overall flag', () => {
  it('is GREEN when every check is green', () => {
    const ev = evaluate(ideal(), T);
    expect(ev.checks.filter((c) => c.status !== 'green' && c.status !== 'info')).toEqual([]);
    expect(ev.flag).toBe('green');
    expect(ev.decisive).toBeNull();
  });
  it('any AMBER → AMBER', () => {
    const ev = evaluate(ideal({ rh: r(35), dewPoint: r(0) }), T);
    expect(ev.flag).toBe('amber');
    expect(ev.decisive?.id).toBe('humidity');
  });
  it('any RED → RED even with ambers present, and the red check is the stated reason', () => {
    const ev = evaluate(ideal({ rh: r(35), dewPoint: r(0), gust: r(7.4) }), T);
    expect(ev.flag).toBe('red');
    expect(ev.decisive?.id).toBe('gust');
    expect(formatReason(ev.decisive!.reason, 'lv')).toBe('Brāzmas 7.4 m/s (>7.0)');
  });
  it('missing data is never green', () => {
    const ev = evaluate(ideal({ wind: null }), T);
    expect(ev.checks.find((c) => c.id === 'wind')!.status).toBe('amber');
    expect(ev.flag).toBe('amber');
  });
  it('info-only crop row does not affect the flag', () => {
    expect(evaluate(ideal(), T, null, { cropId: null, bbch: null }).flag).toBe('green');
  });
});

describe('1. wind', () => {
  it.each([[0.5, 'amber'], [0.99, 'amber'], [1, 'green'], [3, 'green'], [3.1, 'amber'], [5, 'amber'], [5.1, 'red']])(
    '%s m/s → %s', (v, s) => expect(status(ideal({ wind: r(v) }), 'wind')).toBe(s));
});
describe('2. gusts', () => {
  it.each([[7, 'green'], [7.1, 'red']])('%s m/s → %s', (v, s) => expect(status(ideal({ gust: r(v) }), 'gust')).toBe(s));
});
describe('3. rain', () => {
  const rain = (prob: number | null, mm: number | null) => ideal({ rainRequired: { hours: 2, prob, mm } });
  it('dry window → green', () => expect(status(rain(10, 0), 'rain')).toBe('green'));
  it('probability at amber threshold → amber', () => expect(status(rain(30, 0), 'rain')).toBe('amber'));
  it('probability at red threshold → red', () => expect(status(rain(60, 0), 'rain')).toBe('red'));
  it('amount alone can trigger', () => {
    expect(status(rain(0, 0.2), 'rain')).toBe('amber');
    expect(status(rain(0, 0.5), 'rain')).toBe('red');
  });
  it('raining now → red regardless of forecast', () => expect(status(ideal({ precipNow: r(0.4) }), 'rain')).toBe('red'));
  it('no forecast → amber (no data)', () => expect(status(rain(null, null), 'rain')).toBe('amber'));
});
describe('4. temperature', () => {
  it.each([[4.9, 'red'], [5, 'amber'], [7.9, 'amber'], [8, 'green'], [25, 'green'], [25.1, 'amber'], [28, 'amber'], [28.1, 'red']])(
    '%s °C → %s', (v, s) => expect(status(ideal({ temp: r(v), dewPoint: r(v - 6), rh: r(65) }), 'temp')).toBe(s));
});
describe('5. humidity', () => {
  it.each([[39, 'amber'], [40, 'green']])('%s %% → %s', (v, s) => expect(status(ideal({ rh: r(v) }), 'humidity')).toBe(s));
});
describe('6. delta T', () => {
  it('2–8 green', () => expect(status(ideal({ temp: r(20), rh: r(50) }), 'deltaT')).toBe('green'));
  it('<2 amber', () => expect(status(ideal({ temp: r(12), rh: r(95) }), 'deltaT')).toBe('amber'));
  it('8–10 amber', () => expect(status(ideal({ temp: r(24), rh: r(40) }), 'deltaT')).toBe('amber'));
  it('>10 red', () => expect(status(ideal({ temp: r(27), rh: r(25) }), 'deltaT')).toBe('red'));
});
describe('7. inversion', () => {
  const night = { isNight: true, nearSunriseOrSunset: false, sunrise: null, sunset: null };
  it('calm + clear + night → amber', () => expect(status(ideal({ wind: r(1.2), cloud: r(10), sun: night }), 'inversion')).toBe('amber'));
  it('calm + clear + near sunrise → amber', () =>
    expect(status(ideal({ wind: r(1.2), cloud: r(10), sun: { ...night, isNight: false, nearSunriseOrSunset: true } }), 'inversion')).toBe('amber'));
  it('needs all three: cloudy night is fine', () => expect(status(ideal({ wind: r(1.2), cloud: r(90), sun: night }), 'inversion')).toBe('green'));
  it('needs all three: windy clear night is fine', () => expect(status(ideal({ wind: r(2.5), cloud: r(0), sun: night }), 'inversion')).toBe('green'));
  it('needs all three: calm clear midday is fine', () => expect(status(ideal({ wind: r(1.2), cloud: r(0) }), 'inversion')).toBe('green'));
  it('unknown cloud cover is treated as clear', () => expect(status(ideal({ wind: r(1.2), cloud: null, sun: night }), 'inversion')).toBe('amber'));
});
describe('8. frost', () => {
  it('frost in the last 24 h → amber', () => expect(status(ideal({ minTempPastWindow: -0.5 }), 'frost')).toBe('amber'));
  it('frost in the next 24 h → amber', () => expect(status(ideal({ minTempNextWindow: 0 }), 'frost')).toBe('amber'));
  it('no frost → green', () => expect(status(ideal(), 'frost')).toBe('green'));
});
describe('9. dew', () => {
  it('dew point within 2 °C → amber', () => expect(status(ideal({ temp: r(10), dewPoint: r(8) }), 'dew')).toBe('amber'));
  it('wider spread → green', () => expect(status(ideal({ temp: r(15), dewPoint: r(8) }), 'dew')).toBe('green'));
  it('falls back to T + RH when no dew point is reported', () =>
    expect(status(ideal({ temp: r(10), rh: r(97), dewPoint: null }), 'dew')).toBe('amber'));
});

describe('product profile overrides', () => {
  it('max wind: stricter product limit turns moderate wind RED and names the product', () => {
    const ev = evaluate(ideal({ wind: r(3.5) }), T, product({ maxWind: 3 }));
    expect(ev.flag).toBe('red');
    expect(formatReason(ev.decisive!.reason, 'en')).toBe('Wind 3.5 m/s exceeds TestProd limit 3.0 m/s');
  });
  it('min/max temp replace the red limits', () => {
    expect(status(ideal({ temp: r(9) }), 'temp', product({ minTemp: 10 }))).toBe('red');
    expect(status(ideal({ temp: r(6), dewPoint: r(1) }), 'temp', product({ minTemp: 2 }))).toBe('amber');
    expect(status(ideal({ temp: r(21) }), 'temp', product({ maxTemp: 20 }))).toBe('red');
    expect(status(ideal({ temp: r(27), rh: r(60) }), 'temp', product({ maxTemp: 30 }))).toBe('amber');
  });
  it('BBCH outside the label range → RED; inside → green; unset → amber', () => {
    const p = product({ bbchMin: 30, bbchMax: 39 });
    expect(status(ideal(), 'crop', p, { cropId: 'winter-wheat', bbch: 45 })).toBe('red');
    expect(status(ideal(), 'crop', p, { cropId: 'winter-wheat', bbch: 32 })).toBe('green');
    expect(status(ideal(), 'crop', p, { cropId: 'winter-wheat', bbch: null })).toBe('amber');
    expect(status(ideal(), 'crop', p, { cropId: null, bbch: null })).toBe('amber');
  });
  it('rain-free hours of the product are reported in the reason', () => {
    const ev = evaluate(ideal({ rainRequired: { hours: 6, prob: 70, mm: 1.2 } }), T, product({ rainFreeHours: 6 }));
    expect(formatReason(ev.decisive!.reason, 'lv')).toBe('TestProd vajag 6 h bez lietus: 70 %, 1.2 mm');
  });
});

describe('editable thresholds', () => {
  it('overrides merge over defaults and change the outcome', () => {
    const t = mergeThresholds({ gustRedAbove: 9, windStrongAbove: 6 });
    expect(t.tempGreenMin).toBe(8);
    expect(status(ideal({ gust: r(8) }), 'gust', null, null, t)).toBe('green');
    expect(status(ideal({ wind: r(5.5) }), 'wind', null, null, t)).toBe('amber');
  });
  it('ignores junk overrides', () => {
    expect(mergeThresholds({ gustRedAbove: NaN, bogus: 1 } as any)).toEqual(DEFAULT_THRESHOLDS);
  });
});
