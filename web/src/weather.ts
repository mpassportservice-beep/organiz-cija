import { deltaT, readingKind, type Reading, type WeatherSnapshotItem } from '@spray/shared';
import type { Ctx } from './App';

/** The weather values shown on screen right now, each with its source – stored with a log record. */
export function weatherItems(ctx: Ctx): WeatherSnapshotItem[] {
  const c = ctx.conditions;
  const lang = ctx.lang;
  if (!c) return [];
  const out: WeatherSnapshotItem[] = [];
  const add = (key: string, label: string, r: Reading | null, unit: string) => {
    if (!r || r.value === null) return;
    out.push({ key, label, value: String(r.value), unit, source: r.sourceLabel, station: r.station, distanceKm: r.distanceKm, time: r.time, kind: readingKind(r) });
  };
  const L = (lv: string, en: string) => (lang === 'lv' ? lv : en);
  add('temp', L('Gaisa temperatūra', 'Air temperature'), c.temp, '°C');
  add('rh', L('Relatīvais mitrums', 'Relative humidity'), c.rh, '%');
  add('wind', L('Vējš (10 min vid.)', 'Wind (10 min mean)'), c.wind, 'm/s');
  add('gust', L('Brāzmas', 'Gusts'), c.gust, 'm/s');
  add('windDir', L('Vēja virziens (no)', 'Wind direction (from)'), c.windDir, '°');
  add('precipNow', L('Nokrišņi šobrīd', 'Precipitation now'), c.precipNow, 'mm/h');
  add('dewPoint', L('Rasas punkts', 'Dew point'), c.dewPoint, '°C');
  add('cloud', L('Mākoņu daudzums', 'Cloud cover'), c.cloud, '%');
  const derived = (key: string, label: string, value: string, unit: string, source: string, time = c.time) =>
    out.push({ key, label, value, unit, source, station: '', distanceKm: null, time, kind: 'derived' });
  if (c.temp?.value != null && c.rh?.value != null)
    derived('deltaT', 'Delta T', deltaT(c.temp.value, c.rh.value).toFixed(1), '°C', L('aprēķināts no temp. un mitruma', 'computed from temp and RH'));
  const fc = ctx.snapshot?.forecast;
  for (const w of c.rain) {
    if (w.prob === null && w.mm === null) continue;
    out.push({ key: `rain${w.hours}h`, label: L(`Lietus ${w.hours} h`, `Rain ${w.hours} h`), value: `${w.prob ?? '–'} % / ${w.mm ?? '–'} mm`, unit: '',
      source: fc?.sourceLabel ?? '', station: fc?.models.join(' + ') ?? '', distanceKm: 0, time: fc?.fetchedAt ?? c.time, kind: 'forecast' });
  }
  if (c.minTempPast12 !== null) derived('minTempPast12', L('Min. temp. pēdējās 12 h', 'Min temp last 12 h'), c.minTempPast12.toFixed(1), '°C', c.frostSource);
  if (c.minTempNext12 !== null) derived('minTempNext12', L('Min. temp. nākamās 12 h', 'Min temp next 12 h'), c.minTempNext12.toFixed(1), '°C', fc?.sourceLabel ?? '');
  return out;
}
