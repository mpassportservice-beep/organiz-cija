import type { Thresholds } from './config';
import { deltaT, dewPoint as calcDewPoint, round } from './meteo';
import type { CheckResult, Conditions, CropSelection, Evaluation, Product, Reading, Status } from './types';

const RANK: Record<Status, number> = { info: 0, green: 1, amber: 2, red: 3 };

function val(r: Reading | null | undefined): number | null {
  return r && typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
}
function rs(...r: (Reading | null | undefined)[]): Reading[] {
  return r.filter((x): x is Reading => !!x);
}
const f1 = (n: number) => round(n, 1).toFixed(1);
const f0 = (n: number) => String(Math.round(n));

function noData(id: CheckResult['id'], readings: Reading[] = []): CheckResult {
  // Missing data can never be green: the farmer must not get a go-ahead on a blind spot.
  return { id, status: 'amber', reason: { key: 'noData' }, value: null, readings };
}

/**
 * Pure rules engine: conditions + thresholds (+ optional product, crop) → per-check status and overall flag.
 * Overall flag = worst individual status (any RED → RED; any AMBER → AMBER).
 */
export function evaluate(
  c: Conditions,
  t: Thresholds,
  product?: Product | null,
  crop?: CropSelection | null,
): Evaluation {
  const checks: CheckResult[] = [];
  const pName = product?.name ?? '';

  // 1. Wind (10 min mean)
  {
    const v = val(c.wind);
    const readings = rs(c.wind, c.windDir);
    if (v === null) checks.push(noData('wind', readings));
    else {
      const productLimit = product?.maxWind ?? null;
      const strong = productLimit ?? t.windStrongAbove;
      const gentle = Math.min(t.windGentleMax, strong);
      const base = { id: 'wind' as const, value: f1(v), unit: 'm/s', readings, productRule: productLimit !== null };
      if (v > strong)
        checks.push({ ...base, status: 'red', reason: productLimit !== null
          ? { key: 'wind.product', params: { v: f1(v), limit: f1(strong), product: pName } }
          : { key: 'wind.strong', params: { v: f1(v), limit: f1(strong) } } });
      else if (v < t.windCalmBelow)
        checks.push({ ...base, status: 'amber', reason: { key: 'wind.calm', params: { v: f1(v), limit: f1(t.windCalmBelow) } } });
      else if (v > gentle)
        checks.push({ ...base, status: 'amber', reason: { key: 'wind.moderate', params: { v: f1(v) } } });
      else checks.push({ ...base, status: 'green', reason: { key: 'wind.ok', params: { v: f1(v) } } });
    }
  }

  // 2. Gusts
  {
    const v = val(c.gust);
    if (v === null) checks.push(noData('gust', rs(c.gust)));
    else {
      const base = { id: 'gust' as const, value: f1(v), unit: 'm/s', readings: rs(c.gust) };
      if (v > t.gustRedAbove)
        checks.push({ ...base, status: 'red', reason: { key: 'gust.strong', params: { v: f1(v), limit: f1(t.gustRedAbove) } } });
      else checks.push({ ...base, status: 'green', reason: { key: 'gust.ok', params: { v: f1(v) } } });
    }
  }

  // 3. Rain
  {
    const now = val(c.precipNow);
    const w = c.rainRequired;
    const readings = rs(c.rainSource, c.precipNow);
    const productRule = product?.rainFreeHours != null;
    const params = {
      h: w.hours, prob: w.prob === null ? '–' : f0(w.prob), mm: w.mm === null ? '–' : f1(w.mm), product: pName,
    };
    const base = { id: 'rain' as const, value: w.prob === null ? null : f0(w.prob), unit: '%', readings, productRule };
    if (now !== null && now > t.rainNowRedMm)
      checks.push({ ...base, status: 'red', reason: { key: 'rain.now', params: { v: f1(now) } } });
    else if (w.prob === null && w.mm === null) checks.push(noData('rain', readings));
    else if ((w.prob ?? 0) >= t.rainProbRed || (w.mm ?? 0) >= t.rainMmRed)
      checks.push({ ...base, status: 'red', reason: { key: productRule ? 'rain.productRed' : 'rain.red', params } });
    else if ((w.prob ?? 0) >= t.rainProbAmber || (w.mm ?? 0) >= t.rainMmAmber)
      checks.push({ ...base, status: 'amber', reason: { key: productRule ? 'rain.productAmber' : 'rain.amber', params } });
    else checks.push({ ...base, status: 'green', reason: { key: 'rain.ok', params } });
  }

  // 4. Air temperature
  const temp = val(c.temp);
  {
    if (temp === null) checks.push(noData('temp', rs(c.temp)));
    else {
      const pMin = product?.minTemp ?? null;
      const pMax = product?.maxTemp ?? null;
      const redLow = pMin ?? t.tempRedBelow;
      const redHigh = pMax ?? t.tempRedAbove;
      const greenMin = Math.max(t.tempGreenMin, redLow);
      const greenMax = Math.min(t.tempGreenMax, redHigh);
      const base = { id: 'temp' as const, value: f1(temp), unit: '°C', readings: rs(c.temp), productRule: pMin !== null || pMax !== null };
      if (temp < redLow)
        checks.push({ ...base, status: 'red', reason: { key: pMin !== null ? 'temp.productLow' : 'temp.low', params: { v: f1(temp), limit: f1(redLow), product: pName } } });
      else if (temp > redHigh)
        checks.push({ ...base, status: 'red', reason: { key: pMax !== null ? 'temp.productHigh' : 'temp.high', params: { v: f1(temp), limit: f1(redHigh), product: pName } } });
      else if (temp < greenMin)
        checks.push({ ...base, status: 'amber', reason: { key: 'temp.cool', params: { v: f1(temp), limit: f1(greenMin) } } });
      else if (temp > greenMax)
        checks.push({ ...base, status: 'amber', reason: { key: 'temp.warm', params: { v: f1(temp), limit: f1(greenMax) } } });
      else checks.push({ ...base, status: 'green', reason: { key: 'temp.ok', params: { v: f1(temp) } } });
    }
  }

  // 5. Relative humidity
  const rh = val(c.rh);
  {
    if (rh === null) checks.push(noData('humidity', rs(c.rh)));
    else {
      const base = { id: 'humidity' as const, value: f0(rh), unit: '%', readings: rs(c.rh) };
      if (rh < t.humidityAmberBelow)
        checks.push({ ...base, status: 'amber', reason: { key: 'humidity.low', params: { v: f0(rh), limit: f0(t.humidityAmberBelow) } } });
      else checks.push({ ...base, status: 'green', reason: { key: 'humidity.ok', params: { v: f0(rh) } } });
    }
  }

  // 6. Delta T
  {
    if (temp === null || rh === null) checks.push(noData('deltaT', rs(c.temp, c.rh)));
    else {
      const d = deltaT(temp, rh);
      const base = { id: 'deltaT' as const, value: f1(d), unit: '°C', readings: rs(c.temp, c.rh) };
      if (d > t.deltaTRedAbove)
        checks.push({ ...base, status: 'red', reason: { key: 'deltaT.red', params: { v: f1(d), limit: f1(t.deltaTRedAbove) } } });
      else if (d > t.deltaTGreenMax)
        checks.push({ ...base, status: 'amber', reason: { key: 'deltaT.high', params: { v: f1(d), limit: f1(t.deltaTGreenMax) } } });
      else if (d < t.deltaTGreenMin)
        checks.push({ ...base, status: 'amber', reason: { key: 'deltaT.low', params: { v: f1(d), limit: f1(t.deltaTGreenMin) } } });
      else checks.push({ ...base, status: 'green', reason: { key: 'deltaT.ok', params: { v: f1(d) } } });
    }
  }

  // 7. Inversion risk
  {
    const w = val(c.wind);
    const cloud = val(c.cloud);
    const readings = rs(c.wind, c.cloud);
    if (w === null) checks.push(noData('inversion', readings));
    else {
      const calm = w < t.inversionWindBelow;
      const clear = cloud === null ? true : cloud <= t.inversionCloudMax; // unknown sky → assume clear
      const lowSun = c.sun.isNight || c.sun.nearSunriseOrSunset;
      if (calm && clear && lowSun)
        checks.push({ id: 'inversion', status: 'amber', value: null, readings,
          reason: { key: c.sun.isNight ? 'inversion.night' : 'inversion.lowSun', params: { v: f1(w), cloud: cloud === null ? '–' : f0(cloud) } } });
      else checks.push({ id: 'inversion', status: 'green', value: null, readings, reason: { key: 'inversion.none' } });
    }
  }

  // 8. Frost
  {
    const past = c.minTempPastWindow;
    const next = c.minTempNextWindow;
    const show = [c.minTempPast12, c.minTempNext12].map((x) => (x === null ? '–' : f1(x))).join(' / ');
    const base = { id: 'frost' as const, value: show, unit: '°C', readings: [] as Reading[] };
    const h = t.frostWindowHours;
    if (past === null && next === null) checks.push(noData('frost'));
    else if (next !== null && next <= t.frostTempC)
      checks.push({ ...base, status: 'amber', reason: { key: 'frost.next', params: { v: f1(next), h } } });
    else if (past !== null && past <= t.frostTempC)
      checks.push({ ...base, status: 'amber', reason: { key: 'frost.past', params: { v: f1(past), h } } });
    else checks.push({ ...base, status: 'green', reason: { key: 'frost.none', params: { h } } });
  }

  // 9. Leaf wetness / dew
  {
    let dp = val(c.dewPoint);
    if (dp === null && temp !== null && rh !== null) dp = calcDewPoint(temp, rh);
    if (temp === null || dp === null) checks.push(noData('dew', rs(c.temp, c.dewPoint)));
    else {
      const spread = Math.max(0, temp - dp);
      const base = { id: 'dew' as const, value: f1(spread), unit: '°C', readings: rs(c.dewPoint ?? c.rh, c.temp) };
      if (spread <= t.dewSpreadAmberC)
        checks.push({ ...base, status: 'amber', reason: { key: 'dew.wet', params: { v: f1(spread), dp: f1(dp) } } });
      else checks.push({ ...base, status: 'green', reason: { key: 'dew.ok', params: { v: f1(spread), dp: f1(dp) } } });
    }
  }

  // 10. Crop stage vs product label
  {
    const bbch = crop?.bbch ?? null;
    const hasRange = product != null && (product.bbchMin != null || product.bbchMax != null);
    const base = { id: 'crop' as const, value: bbch === null ? null : String(bbch), unit: 'BBCH', readings: [] as Reading[], productRule: hasRange };
    if (!crop?.cropId) checks.push({ ...base, status: hasRange ? 'amber' : 'info', reason: { key: hasRange ? 'crop.missingForProduct' : 'crop.notSet', params: { product: pName } } });
    else if (hasRange) {
      const lo = product!.bbchMin ?? 0;
      const hi = product!.bbchMax ?? 99;
      if (bbch === null) checks.push({ ...base, status: 'amber', reason: { key: 'crop.missingForProduct', params: { product: pName } } });
      else if (bbch < lo || bbch > hi)
        checks.push({ ...base, status: 'red', reason: { key: 'crop.outside', params: { bbch, lo, hi, product: pName } } });
      else checks.push({ ...base, status: 'green', reason: { key: 'crop.inside', params: { bbch, lo, hi, product: pName } } });
    } else checks.push({ ...base, status: 'info', reason: { key: bbch === null ? 'crop.noBbch' : 'crop.context', params: { bbch: bbch ?? '' } } });
  }

  return { time: c.time, ...overall(checks), checks };
}

export function overall(checks: CheckResult[]): Pick<Evaluation, 'flag' | 'decisive'> {
  let worst: CheckResult | null = null;
  for (const ch of checks) {
    if (ch.status === 'info') continue;
    if (!worst || RANK[ch.status] > RANK[worst.status]) worst = ch;
  }
  if (!worst) return { flag: 'amber', decisive: null };
  return { flag: worst.status as Evaluation['flag'], decisive: worst.status === 'green' ? null : worst };
}
