import type { CheckId, CheckResult, Lang } from './types';

/** Rule reasons. Kept next to the engine so server (push, PDF) and UI say exactly the same thing. */
const REASONS: Record<string, { lv: string; en: string }> = {
  noData: { lv: 'Nav datu', en: 'No data' },
  'wind.strong': { lv: 'Stiprs vējš {v} m/s (>{limit})', en: 'Strong wind {v} m/s (>{limit})' },
  'wind.product': { lv: 'Vējš {v} m/s pārsniedz {product} limitu {limit} m/s', en: 'Wind {v} m/s exceeds {product} limit {limit} m/s' },
  'wind.calm': { lv: 'Bezvējš {v} m/s – inversijas un neparedzamas noneses risks', en: 'Too calm {v} m/s – inversion / drift risk' },
  'wind.moderate': { lv: 'Mērens vējš {v} m/s – nonese iespējama', en: 'Moderate wind {v} m/s – drift possible' },
  'wind.ok': { lv: 'Lēns vējš {v} m/s', en: 'Gentle wind {v} m/s' },
  'gust.strong': { lv: 'Brāzmas {v} m/s (>{limit})', en: 'Gusts {v} m/s (>{limit})' },
  'gust.ok': { lv: 'Brāzmas {v} m/s', en: 'Gusts {v} m/s' },
  'rain.now': { lv: 'Līst ({v} mm/h)', en: 'Raining now ({v} mm/h)' },
  'rain.red': { lv: 'Lietus tuvāko {h} h laikā: {prob} %, {mm} mm', en: 'Rain within {h} h: {prob} %, {mm} mm' },
  'rain.amber': { lv: 'Lietus iespējams {h} h laikā: {prob} %, {mm} mm', en: 'Rain possible within {h} h: {prob} %, {mm} mm' },
  'rain.productRed': { lv: '{product} vajag {h} h bez lietus: {prob} %, {mm} mm', en: '{product} needs {h} h rain-free: {prob} %, {mm} mm' },
  'rain.productAmber': { lv: '{product} vajag {h} h bez lietus: {prob} %, {mm} mm', en: '{product} needs {h} h rain-free: {prob} %, {mm} mm' },
  'rain.ok': { lv: 'Sauss tuvākās {h} h ({prob} %)', en: 'Dry for next {h} h ({prob} %)' },
  'temp.low': { lv: 'Par aukstu: {v} °C (<{limit})', en: 'Too cold: {v} °C (<{limit})' },
  'temp.high': { lv: 'Par karstu: {v} °C (>{limit})', en: 'Too hot: {v} °C (>{limit})' },
  'temp.productLow': { lv: '{v} °C zem {product} minimuma {limit} °C', en: '{v} °C below {product} minimum {limit} °C' },
  'temp.productHigh': { lv: '{v} °C virs {product} maksimuma {limit} °C', en: '{v} °C above {product} maximum {limit} °C' },
  'temp.cool': { lv: 'Vēss: {v} °C (optimāli no {limit})', en: 'Cool: {v} °C (optimal from {limit})' },
  'temp.warm': { lv: 'Silts: {v} °C (optimāli līdz {limit})', en: 'Warm: {v} °C (optimal up to {limit})' },
  'temp.ok': { lv: 'Temperatūra {v} °C', en: 'Temperature {v} °C' },
  'humidity.low': { lv: 'Sauss gaiss {v} % – pilieni iztvaiko', en: 'Dry air {v} % – droplets evaporate' },
  'humidity.ok': { lv: 'Mitrums {v} %', en: 'Humidity {v} %' },
  'deltaT.red': { lv: 'Delta T {v} (>{limit}) – strauja iztvaikošana', en: 'Delta T {v} (>{limit}) – rapid evaporation' },
  'deltaT.high': { lv: 'Delta T {v} (>{limit}) – paaugstināta iztvaikošana', en: 'Delta T {v} (>{limit}) – raised evaporation' },
  'deltaT.low': { lv: 'Delta T {v} (<{limit}) – pilieni ilgi nežūst, nonese', en: 'Delta T {v} (<{limit}) – droplets stay airborne' },
  'deltaT.ok': { lv: 'Delta T {v}', en: 'Delta T {v}' },
  'inversion.night': { lv: 'Inversijas risks: nakts, skaidrs, vējš {v} m/s', en: 'Inversion risk: night, clear sky, wind {v} m/s' },
  'inversion.lowSun': { lv: 'Inversijas risks: saullēkts/saulriets, skaidrs, vējš {v} m/s', en: 'Inversion risk: near sunrise/sunset, clear, wind {v} m/s' },
  'inversion.none': { lv: 'Inversijas risks zems', en: 'Inversion risk low' },
  'frost.next': { lv: 'Salna tuvāko {h} h laikā (min {v} °C)', en: 'Frost within next {h} h (min {v} °C)' },
  'frost.past': { lv: 'Salna pēdējo {h} h laikā (min {v} °C)', en: 'Frost in last {h} h (min {v} °C)' },
  'frost.none': { lv: 'Salnas nav (±{h} h)', en: 'No frost (±{h} h)' },
  'dew.wet': { lv: 'Rasa / mitras lapas (rasas punkts {dp} °C)', en: 'Dew / wet leaves (dew point {dp} °C)' },
  'dew.ok': { lv: 'Lapas sausas (rasas punkts {dp} °C)', en: 'Leaves dry (dew point {dp} °C)' },
  'crop.notSet': { lv: 'Kultūraugs nav izvēlēts', en: 'Crop not selected' },
  'crop.noBbch': { lv: 'BBCH stadija nav norādīta', en: 'BBCH stage not set' },
  'crop.context': { lv: 'BBCH {bbch}', en: 'BBCH {bbch}' },
  'crop.missingForProduct': { lv: 'Norādiet kultūraugu un BBCH – {product} ir stadijas ierobežojums', en: 'Set crop and BBCH – {product} has a stage restriction' },
  'crop.outside': { lv: 'BBCH {bbch} ārpus {product} atļautā {lo}–{hi}', en: 'BBCH {bbch} outside {product} allowed {lo}–{hi}' },
  'crop.inside': { lv: 'BBCH {bbch} atbilst {product} ({lo}–{hi})', en: 'BBCH {bbch} within {product} label ({lo}–{hi})' },
};

export function formatReason(reason: CheckResult['reason'] | null | undefined, lang: Lang): string {
  if (!reason) return '';
  const tpl = REASONS[reason.key]?.[lang] ?? reason.key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(reason.params?.[k] ?? ''));
}

export const CHECK_LABELS: Record<CheckId, { lv: string; en: string }> = {
  wind: { lv: 'Vējš (10 min vid.)', en: 'Wind (10 min mean)' },
  gust: { lv: 'Vēja brāzmas', en: 'Wind gusts' },
  rain: { lv: 'Lietus', en: 'Rain' },
  temp: { lv: 'Gaisa temperatūra', en: 'Air temperature' },
  humidity: { lv: 'Relatīvais mitrums', en: 'Relative humidity' },
  deltaT: { lv: 'Delta T', en: 'Delta T' },
  inversion: { lv: 'Inversijas risks', en: 'Inversion risk' },
  frost: { lv: 'Salna (−12 h / +12 h min)', en: 'Frost (−12 h / +12 h min)' },
  dew: { lv: 'Rasa / lapu mitrums', en: 'Dew / leaf wetness' },
  crop: { lv: 'Kultūrauga stadija', en: 'Crop stage' },
};

export const FLAG_LABELS = {
  green: { lv: 'Var smidzināt', en: 'OK to spray' },
  amber: { lv: 'Uzmanīgi', en: 'Caution' },
  red: { lv: 'Nesmidzināt', en: 'Do not spray' },
} as const;
