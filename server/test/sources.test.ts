import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTime } from '../src/http';
import { mapColumns, parseLvcRecords } from '../src/sources/lvc';
import { nearestStation, parseObservations, parseStations, stationsByDistance } from '../src/sources/lvgmc';
import { sourceOk } from '../src/db';
import { assembleSnapshot } from '../src/weather';
import { buildUrl } from '../src/sources/openMeteo';
import { parseForecast } from '../src/sources/openMeteo';
import { mergeHourlyTemps } from '../src/weather';
import { logsToCsv } from '../src/export';

const fx = (n: string) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const FARM = { lat: 57.315, lon: 25.355 };

describe('LVĢMC (recorded live response)', () => {
  const stations = parseStations(fx('lvgmc-stations.json').result.records);
  it('nearest station to the farm is Priekuļi, ~1 km', () => {
    expect(nearestStation(stations, FARM.lat, FARM.lon)).toMatchObject({ id: 'RIPR99PA', name: 'Priekuļi' });
  });
  it('parses the latest observation and treats timestamps as UTC', () => {
    const st = stations.find((s) => s.id === 'RIPR99PA')!;
    const r = parseObservations(fx('lvgmc-priekuli.json').result.records, st, FARM);
    expect(r.observation).toMatchObject({
      source: 'lvgmc', station: 'Priekuļi', distanceKm: 1, time: '2026-11-16T10:00:00.000Z',
      values: { temp: 3.4, rh: 75, wind: 6.3, gust: 9.3, windDir: 178, precip: 0 },
    });
    expect(r.hourlyMinTemps.length).toBeGreaterThanOrEqual(24);
    expect(r.hourlyMinTemps.at(-1)).toEqual({ t: '2026-11-16T10:00:00.000Z', temp: 2.2, observed: true });
  });
  it('empty feed → no observation, no crash', () => {
    expect(parseObservations([], stations[0], FARM).observation).toBeNull();
  });
});

describe('LVC road stations (schema of LVC published CSVs; live dataset not publicly readable at build time)', () => {
  const fields = ['stacija', 'nosaukums', 'datums', 'AT', 'RH', 'DP', 'WS', 'WD', 'WSM', 'RI'];
  const row = (stacija: string, nosaukums: string, datums: string, o: object = {}) =>
    ({ stacija, nosaukums, datums, AT: 12.3, RH: 70, DP: 6.9, WS: 2.4, WD: 210, WSM: 4.8, RI: 0, ...o });
  const registry = [{ name: 'Melturi', lat: 57.2167, lon: 25.2333 }, { code: 'LV99', lat: 57.33, lon: 25.61 }, { name: 'Rīga', lat: 56.95, lon: 24.1 }];
  const opts = { maxStations: 2, maxKm: 40, timezone: 'Europe/Riga' };

  it('maps short codes and Latvian headers', () => {
    expect(mapColumns(fields)).toMatchObject({ stationId: 'stacija', time: 'datums', temp: 'AT', gust: 'WSM', precip: 'RI' });
    expect(mapColumns(['Stacijas nosaukums', 'Laiks', 'Gaisa temperatūra (°C)', 'Vēja ātrums', 'Vēja brāzmas'])).toMatchObject({
      stationName: 'Stacijas nosaukums', time: 'Laiks', temp: 'Gaisa temperatūra (°C)', wind: 'Vēja ātrums', gust: 'Vēja brāzmas' });
  });
  it('keeps the latest row per station, ranks by distance, drops far ones, converts local time', () => {
    const r = parseLvcRecords(fields, [
      row('LV10', 'A2 Melturi', '2026-05-20T08:50:00', { WS: 1 }),
      row('LV10', 'A2 Melturi', '2026-05-20T09:00:00'),
      row('LV99', 'P20 km 12', '2026-05-20T09:00:00'),
      row('LV01', 'A6 Rīga', '2026-05-20T09:00:00'),
      row('LV55', 'Nezināma', '2026-05-20T09:00:00'),
    ], registry, FARM, opts);
    expect(r.observations.map((o) => o.stationId)).toEqual(['LV10', 'LV99']);
    expect(r.observations[0]).toMatchObject({ station: 'A2 Melturi', time: '2026-05-20T06:00:00.000Z', values: { wind: 2.4, gust: 4.8, temp: 12.3 } });
    expect(r.observations[0].distanceKm).toBeCloseTo(13.2, 0);
  });
  it('999 means "sensor missing"', () => {
    const r = parseLvcRecords(fields, [row('LV10', 'A2 Melturi', '2026-05-20T09:00:00', { WSM: 999, WD: 999, AT: -999 })], registry, FARM, opts);
    expect(r.observations[0].values).toMatchObject({ gust: null, windDir: null, temp: null, wind: 2.4 });
  });
  it('uses coordinates from the feed when it has them', () => {
    const r = parseLvcRecords([...fields, 'lat', 'lon'], [{ ...row('X1', 'Jauna', '2026-05-20T09:00:00'), lat: 57.3, lon: 25.4 }], [], FARM, opts);
    expect(r.observations[0].distanceKm).toBeLessThan(5);
  });
  it('explains itself when nothing is usable', () => {
    expect(parseLvcRecords(['foo', 'bar'], [{ foo: 1 }], registry, FARM, opts).detail).toMatch(/Unrecognised columns/);
    expect(parseLvcRecords(fields, [row('LV55', 'Nezināma', '2026-05-20T09:00:00')], registry, FARM, opts).detail).toMatch(/lvc-stations\.json/);
  });
});

describe('time parsing', () => {
  it('local time without offset uses the given zone, incl. DST', () => {
    expect(new Date(parseTime('2026-05-20 09:00:00', 'Europe/Riga')).toISOString()).toBe('2026-05-20T06:00:00.000Z');
    expect(new Date(parseTime('2026-01-20T09:00:00', 'Europe/Riga')).toISOString()).toBe('2026-01-20T07:00:00.000Z');
    expect(new Date(parseTime('20.05.2026 09:00', 'Europe/Riga')).toISOString()).toBe('2026-05-20T06:00:00.000Z');
  });
  it('explicit offsets win', () => expect(new Date(parseTime('2026-05-20T09:00:00Z', 'Europe/Riga')).toISOString()).toBe('2026-05-20T09:00:00.000Z'));
  it('garbage → NaN', () => expect(parseTime('n/a', 'UTC')).toBeNaN());
});

describe('Open-Meteo (recorded live response)', () => {
  const j = fx('open-meteo.json');
  const f = parseForecast(j);
  it('merges ECMWF IFS + DWD ICON into quarter-hour slots', () => {
    expect(f.models).toEqual(['ECMWF IFS', 'DWD ICON']);
    expect(f.slots.length).toBe(j.minutely_15.time.length - 1);
    expect(Date.parse(f.slots[1].t) - Date.parse(f.slots[0].t)).toBe(900_000);
  });
  it('takes the higher wind/gust and the mean temperature of the two models', () => {
    const m = j.minutely_15;
    expect(f.slots[0].wind).toBeCloseTo(Math.max(m.wind_speed_10m_ecmwf_ifs025[0], m.wind_speed_10m_icon_seamless[0]), 1);
    expect(f.slots[0].gust).toBe(Math.max(m.wind_gusts_10m_ecmwf_ifs025[0], m.wind_gusts_10m_icon_seamless[0]));
    expect(f.slots[0].temp).toBeCloseTo((m.temperature_2m_ecmwf_ifs025[0] + m.temperature_2m_icon_seamless[0]) / 2, 1);
  });
  it('every slot carries probability and cloud from the hourly series', () => {
    const inner = f.slots.slice(0, -8);
    expect(inner.every((s) => s.cloud !== null && s.precipProb !== null && s.precip !== null)).toBe(true);
  });
  it('survives one model returning nothing', () => {
    const k = structuredClone(j);
    for (const key of Object.keys(k.minutely_15)) if (key.endsWith('icon_seamless')) k.minutely_15[key] = k.minutely_15[key].map(() => null);
    expect(parseForecast(k).models).toEqual(['ECMWF IFS']);
  });
  it('rejects an empty response', () => expect(() => parseForecast({})).toThrow());
});

describe('snapshot helpers', () => {
  it('observed hourly minima replace model temperatures for the same hour', () => {
    const out = mergeHourlyTemps(
      [{ t: '2026-05-20T05:00:00.000Z', temp: 4, observed: false }, { t: '2026-05-20T06:00:00.000Z', temp: 5, observed: false }],
      [{ t: '2026-05-20T05:00:00.000Z', temp: -0.4, observed: true }]);
    expect(out).toEqual([{ t: '2026-05-20T05:00:00.000Z', temp: -0.4, observed: true }, { t: '2026-05-20T06:00:00.000Z', temp: 5, observed: false }]);
  });
});

describe('CSV export', () => {
  it('quotes separators and neutralises formulas', () => {
    const csv = logsToCsv([{
      id: '1', startedAt: '2026-05-20T06:00:00.000Z', field: { id: 'f', name: 'Lauks; "A"', areaHa: 12.5 }, crop: { id: 'oats', name: 'Auzas', bbch: 31 },
      product: { name: '=HYPERLINK("x")', regNumber: '0123', beeHazard: true, phiDays: 35 }, dose: '1,5', doseUnit: 'l/ha', waterLHa: '200', purpose: '',
      earliestHarvest: '2026-06-24', operator: { name: 'J. Bērziņš', certificate: 'AA-1' }, nozzle: '', flag: 'green', flagReason: '', checks: [],
      weather: [{ key: 'wind', label: 'Vējš', value: '2.4', unit: 'm/s', source: 'LVC', station: 'Melturi', distanceKm: 13.2, time: '2026-05-20T06:00:00.000Z', kind: 'observation' }],
      prechecks: [{ id: 'bees', label: 'Bites', checked: true }], notes: '',
    }], 'lv');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [, line] = csv.split('\r\n');
    expect(line).toContain('20.05.2026;09:00');
    expect(line).toContain('"Lauks; ""A"""');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain('2.4 m/s;LVC;Melturi;13.2');
  });

  it('lists the other fields of a multi-field pass', () => {
    const base = {
      startedAt: '2026-05-20T06:00:00.000Z', crop: { id: null, name: '', bbch: null },
      product: { name: 'X', regNumber: '', beeHazard: false, phiDays: null }, dose: '1', doseUnit: 'l/ha', waterLHa: '', purpose: '',
      earliestHarvest: null, operator: { name: '', certificate: '' }, nozzle: '', flag: 'green' as const, flagReason: '', checks: [],
      weather: [], prechecks: [], notes: '',
    };
    const batch = { id: 'b', group: 'Grupa A', fields: ['L1', 'L2', 'L3'] };
    const csv = logsToCsv([
      { ...base, id: '1', field: { id: 'f1', name: 'L1', areaHa: 1 }, batch },
      { ...base, id: '2', field: { id: 'f4', name: 'L4', areaHa: 1 }, batch: null },
    ], 'lv');
    const [head, a, b] = csv.split('\r\n');
    expect(head).toContain('Smidzināts kopā ar');
    expect(a).toContain(';Grupa A – L2, L3;');
    expect(b).not.toContain('Grupa');
  });
});

describe('chosen location', () => {
  it('ranks LVĢMC stations by distance from any point', () => {
    const stations = parseStations(fx('lvgmc-stations.json').result.records);
    const near = stationsByDistance(stations, 56.51, 21.01).slice(0, 2).map((s) => s.name); // Liepāja
    expect(near[0]).toMatch(/Liepāja/);
    expect(stationsByDistance(stations, 57.315, 25.355)[0].id).toBe('RIPR99PA');
  });
  it('forecast is requested for the point itself', () => {
    expect(buildUrl({ lat: 56.95, lon: 24.1 })).toContain('latitude=56.95&longitude=24.1');
  });
  it('never shows weather cached for another place', () => {
    sourceOk('open-meteo', { slots: [{ t: 'x' }], hourlyTemps: [], sunrise: [], sunset: [], models: ['M'], farmKey: '57.3150,25.3550' }, 'M');
    const farm = { name: 'Rīga', lat: 56.95, lon: 24.1, timezone: 'Europe/Riga' };
    expect(assembleSnapshot(farm).forecast.slots).toEqual([]);
    expect(assembleSnapshot(farm).farm.name).toBe('Rīga');
    expect(assembleSnapshot({ ...farm, lat: 57.315, lon: 25.355 }).forecast.slots).toHaveLength(1);
  });
});
