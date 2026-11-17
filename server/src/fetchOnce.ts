/** Diagnostic: fetch every source once and print what the app would use. `npm run fetch-once -w server` */
import { conditionsNow, evaluate, formatReason, mergeThresholds } from '@spray/shared';
import { refreshAll } from './weather';

const snap = await refreshAll((m) => console.warn(m));
for (const s of snap.sources) console.log(`${s.ok ? 'OK  ' : 'FAIL'} ${s.id.padEnd(11)} ${s.ok ? s.detail ?? '' : s.error}`);
for (const o of snap.observations) console.log(`obs ${o.source} ${o.station} ${o.distanceKm} km @ ${o.time}`, o.values);
console.log(`forecast: ${snap.forecast.slots.length} slots ${snap.forecast.slots[0]?.t} → ${snap.forecast.slots.at(-1)?.t}; hourly temps ${snap.forecast.hourlyTemps.length}`);
const t = mergeThresholds();
const ev = evaluate(conditionsNow(snap, Date.now(), t), t);
console.log(`FLAG ${ev.flag.toUpperCase()}: ${formatReason(ev.decisive?.reason, 'en')}`);
for (const c of ev.checks) console.log(`  ${c.status.padEnd(5)} ${c.id.padEnd(9)} ${formatReason(c.reason, 'en')}`);
