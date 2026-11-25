import { useState } from 'react';
import {
  CHECK_LABELS, CROPS, FLAG_LABELS, deltaT, formatReason, readingKind,
  combineProducts, spectrumOf, type LogRecord, type LoggedProduct, type Product, type Reading, type WeatherSnapshotItem,
} from '@spray/shared';
import type { Ctx } from '../App';
import { fieldCount } from '../i18n';
import { Btn, Card, inputCls, Labeled, localDateIso, STATUS_BG, StatusIcon } from '../ui';
import { InfoButton, ProductInfo } from './ProductInfo';

const UNITS = ['l/ha', 'kg/ha', 'ml/ha', 'g/ha'];

function weatherItems(ctx: Ctx): WeatherSnapshotItem[] {
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

export function Precheck({ ctx, onDone, onCancel }: { ctx: Ctx; onDone: (synced: boolean, count: number) => void; onCancel: () => void }) {
  const { t, lang, state, update, rule, evaluation: ev } = ctx;
  const [sel, setSel] = useState<string[]>(() => rule.targetFields.map((x) => x.id));
  const selFields = state.fields.filter((x) => sel.includes(x.id));
  const toggleField = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const totalHa = selFields.reduce((a, x) => a + (x.areaHa ?? 0), 0);

  // Products of this spraying = the selection on the main screen, so the flag above always matches the mix.
  const chosen = rule.products;
  const toggleProduct = (id: string) => update((s) => ({
    selectedProductIds: s.selectedProductIds.includes(id) ? s.selectedProductIds.filter((x) => x !== id) : [...s.selectedProductIds, id],
  }));
  const [doses, setDoses] = useState<Record<string, { dose: string; unit: string }>>({});
  const doseOf = (p: Product) => doses[p.id] ?? {
    dose: (p.defaultDose ?? '').replace(/\s*(l|kg|ml|g)\/ha\s*$/i, '').trim(),
    unit: UNITS.find((u) => (p.defaultDose ?? '').toLowerCase().includes(u)) ?? 'l/ha',
  };
  const setDose = (p: Product, patch: Partial<{ dose: string; unit: string }>) => setDoses((d) => ({ ...d, [p.id]: { ...doseOf(p), ...patch } }));
  const [info, setInfo] = useState<Product | null>(null);

  const [water, setWater] = useState('');
  // Target is filled from what the chosen products control, until the user writes their own.
  const autoPurpose = spectrumOf(chosen).join(', ');
  const [ownPurpose, setOwnPurpose] = useState<string | null>(null);
  const purpose = ownPurpose ?? autoPurpose;
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const missingDose = chosen.some((p) => doseOf(p).dose.trim() === '');
  const ready = chosen.length > 0 && !missingDose && !!ev && selFields.length > 0;

  async function save() {
    if (!ready || !ev) return;
    setSaving(true);
    const now = Date.now();
    const batchId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const groupName = rule.group && rule.group.fieldIds.every((id) => sel.includes(id)) ? rule.group.name : null;
    const weather = weatherItems(ctx);
    const mix = combineProducts(chosen)!;
    const products: LoggedProduct[] = chosen.map((p) => ({
      name: p.name, regNumber: p.regNumber ?? '', dose: doseOf(p).dose.trim(), doseUnit: doseOf(p).unit, activeSubstances: p.activeSubstances ?? [],
    }));
    const single = products.length === 1;
    const recs: LogRecord[] = selFields.map((f, i) => {
      const crop = CROPS.find((c) => c.id === f.cropId);
      return {
        id: `${batchId}-${i}`,
        startedAt: new Date(now).toISOString(), endedAt: null,
        field: { id: f.id, name: f.name, areaHa: f.areaHa },
        crop: { id: f.cropId, name: crop ? crop[lang] : '', bbch: f.bbch },
        product: { name: mix.name, regNumber: mix.regNumber ?? '', beeHazard: mix.beeHazard, phiDays: mix.phiDays },
        products,
        dose: single ? products[0].dose : products.map((p) => `${p.dose} ${p.doseUnit}`).join(' + '),
        doseUnit: single ? products[0].doseUnit : '',
        waterLHa: water.trim(), purpose: purpose.trim(),
        earliestHarvest: mix.phiDays != null ? localDateIso(now + mix.phiDays * 86_400_000) : null,
        operator: { ...state.operator }, nozzle: '',
        flag: ev.flag, flagReason: ev.decisive ? formatReason(ev.decisive.reason, lang) : FLAG_LABELS[ev.flag][lang],
        checks: ev.checks.map((c) => ({ id: c.id, label: CHECK_LABELS[c.id][lang], status: c.status, reason: formatReason(c.reason, lang) })),
        weather,
        prechecks: [],
        notes: notes.trim(),
        batch: selFields.length > 1 ? { id: batchId, group: groupName, fields: selFields.map((x) => x.name) } : null,
      };
    });
    const synced = await ctx.addLog(recs);
    setSaving(false);
    onDone(synced, recs.length);
  }

  return (
    <div className="space-y-3 px-3 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">{t('preTitle')}</h1>
        <Btn kind="ghost" onClick={onCancel}>{t('cancel')}</Btn>
      </div>
      {ev && (
        <div className={`flex items-center gap-3 rounded-xl p-3 ${STATUS_BG[ev.flag]}`}>
          <span className="rounded-full bg-white/95 p-1"><StatusIcon status={ev.flag} size={32} /></span>
          <div>
            <div className="text-xl font-black uppercase">{FLAG_LABELS[ev.flag][lang]}</div>
            <div className="text-sm font-bold">{ev.decisive ? formatReason(ev.decisive.reason, lang) : ''}</div>
            {ev.flag !== 'green' && <div className="text-sm font-semibold">{ev.flag === 'red' ? t('preFlagRed') : t('preFlagAmber')}</div>}
          </div>
        </div>
      )}

      <Card title={t('sprayFields')} action={
        <div className="flex gap-1">
          <button className="min-h-10 rounded-md border-2 border-neutral-900 px-2 text-sm font-bold" onClick={() => setSel(state.fields.map((x) => x.id))}>{t('selectAll')}</button>
          <button className="min-h-10 rounded-md border-2 border-neutral-900 px-2 text-sm font-bold" onClick={() => setSel([])}>{t('selectNone')}</button>
        </div>}>
        <p className="mb-2 text-sm text-neutral-700">{t('sprayFieldsHint')}</p>
        {state.groups.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {state.groups.map((g) => {
              const on = g.fieldIds.length > 0 && g.fieldIds.every((id) => sel.includes(id));
              return (
                <button key={g.id} aria-pressed={on} onClick={() => setSel((s) => (on ? s.filter((x) => !g.fieldIds.includes(x)) : [...new Set([...s, ...g.fieldIds])]))}
                  className={`min-h-10 rounded-md border-2 border-neutral-900 px-2 text-sm font-bold ${on ? 'bg-neutral-950 text-white' : 'bg-white'}`}>▦ {g.name}</button>
              );
            })}
          </div>
        )}
        <ul className="divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900">
          {state.fields.map((x) => {
            const crop = CROPS.find((c) => c.id === x.cropId);
            return (
              <li key={x.id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-1.5">
                  <input type="checkbox" className="h-7 w-7 shrink-0 accent-green-700" checked={sel.includes(x.id)} onChange={() => toggleField(x.id)} />
                  <span className="min-w-0">
                    <span className="block font-bold">{x.name}{x.areaHa ? ` · ${x.areaHa} ha` : ''}</span>
                    {(crop || x.bbch != null) && <span className="block text-sm text-neutral-700">{crop?.[lang] ?? ''}{x.bbch != null ? ` · BBCH ${x.bbch}` : ''}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 text-sm font-bold">
          {selFields.length === 0 ? <span className="text-stop">{t('pickFields')}</span>
            : <>{t('totalArea')}: {fieldCount(selFields.length, lang)}{totalHa > 0 ? ` · ${Math.round(totalHa * 100) / 100} ha` : ''}</>}
        </div>
      </Card>

      <Card title={t('treatment')}>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-sm font-semibold">{t('productName')}</div>
            {state.products.length === 0 ? <p className="rounded-lg bg-amber-100 p-2 text-sm font-semibold">{t('noProductsGoAdd')}</p> : (
              <ul className="divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900">
                {state.products.map((p) => {
                  const on = chosen.some((x) => x.id === p.id);
                  const d = doseOf(p);
                  return (
                    <li key={p.id} className={on ? 'bg-green-50' : ''}>
                      <div className="flex items-center gap-2 pr-2">
                        <label className="flex min-h-12 flex-1 cursor-pointer items-center gap-3 px-3 py-1.5">
                          <input type="checkbox" className="h-7 w-7 shrink-0 accent-green-700" checked={on} onChange={() => toggleProduct(p.id)} />
                          <span className="min-w-0">
                            <span className="block font-bold">{p.name}</span>
                            {(p.activeSubstances?.length ?? 0) > 0 && <span className="block truncate text-xs text-neutral-700">{p.activeSubstances!.map((x) => x.name).join(', ')}</span>}
                          </span>
                        </label>
                        <InfoButton label={`${p.name} – ${t('pInfo')}`} onClick={() => setInfo(p)} />
                      </div>
                      {on && (
                        <div className="grid grid-cols-[1fr_6.5rem] gap-2 px-3 pb-2">
                          <Labeled label={t('dose')}>
                            <input className={`${inputCls} ${d.dose.trim() === '' ? 'border-stop' : ''}`} inputMode="decimal" value={d.dose} onChange={(e) => setDose(p, { dose: e.target.value })} />
                          </Labeled>
                          <Labeled label=" ">
                            <select className={inputCls} value={d.unit} onChange={(e) => setDose(p, { unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                          </Labeled>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {chosen.length > 1 && <p className="mt-1 text-sm font-semibold">{t('mixNote', { n: chosen.length })}</p>}
          </div>
          <Labeled label={t('water')}><input className={inputCls} inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} /></Labeled>
          <Labeled label={t('purpose')} hint={ownPurpose === null && autoPurpose ? t('purposeAuto') : undefined}>
            <textarea className={inputCls} rows={3} value={purpose} placeholder={chosen.length ? t('purposeEmptyPh') : ''} onChange={(e) => setOwnPurpose(e.target.value)} />
          </Labeled>
          {ownPurpose !== null && autoPurpose && ownPurpose !== autoPurpose && (
            <button type="button" className="min-h-10 rounded-md border-2 border-neutral-900 px-2 text-sm font-bold" onClick={() => setOwnPurpose(null)}>↺ {t('purposeReset')}</button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Labeled label={t('operator')}><input className={inputCls} value={state.operator.name} onChange={(e) => update({ operator: { ...state.operator, name: e.target.value } })} /></Labeled>
            <Labeled label={t('certificate')}><input className={inputCls} value={state.operator.certificate} onChange={(e) => update({ operator: { ...state.operator, certificate: e.target.value } })} /></Labeled>
          </div>
        </div>
      </Card>

      <Labeled label={t('notes')}><textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Labeled>
      {!ready && <div className="text-sm font-semibold text-neutral-700">{chosen.length === 0 ? t('needProduct') : missingDose ? t('needDose') : selFields.length === 0 ? t('pickFields') : ''}</div>}
      <Btn className="w-full !min-h-14 text-lg" disabled={!ready || saving} onClick={save}>{t('start')}</Btn>
      {info && <ProductInfo ctx={ctx} p={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
