import { useState } from 'react';
import {
  CHECK_LABELS, CROPS, FLAG_LABELS, formatReason,
  combineProducts, parseNum, spectrumOf, sprayPlan, type SprayPlan, type LogRecord, type LoggedProduct, type Product,
} from '@spray/shared';
import type { Ctx } from '../App';
import { fieldCount } from '../i18n';
import { Btn, Card, fmtHa, inputCls, Labeled, NumInput, STATUS_BG, StatusIcon } from '../ui';
import { weatherItems } from '../weather';
import { InfoButton, ProductInfo } from './ProductInfo';

const UNITS = ['l/ha', 'kg/ha', 'ml/ha', 'g/ha'];

/** 1.623 → "1,623"; large ml/g also shown in l/kg. */
export function fmtAmount(n: number, unit: string, lang: 'lv' | 'en'): string {
  const f = (x: number, d = 3) => {
    const s = String(Math.round(x * 10 ** d) / 10 ** d);
    return lang === 'en' ? s : s.replace('.', ',');
  };
  const big = unit === 'ml' ? 'l' : unit === 'g' ? 'kg' : null;
  return big && n >= 1000 ? `${f(n, 0)} ${unit} (${f(n / 1000)} ${big})` : `${f(n)} ${unit}`;
}

/** "2 pilnas tvertnes + pēdējā 164 l", "1 pilna tvertne", "viena tvertne ar 300 l" */
function fillsText(full: number, last: number, lang: 'lv' | 'en'): string {
  const l = last.toLocaleString('lv-LV');
  if (lang === 'en') {
    if (full === 0) return `one tank of ${l} l`;
    return `${full} full tank${full === 1 ? '' : 's'}${last > 0 ? ` + a last one of ${l} l` : ''}`;
  }
  if (full === 0) return `viena tvertne ar ${l} l`;
  const fulls = full % 10 === 1 && full % 100 !== 11 ? `${full} pilna tvertne` : `${full} pilnas tvertnes`;
  return `${fulls}${last > 0 ? ` + pēdējā ${l} l` : ''}`;
}

function PlanCard({ ctx, plan, needWater, needTank }: { ctx: Ctx; plan: SprayPlan | null; needWater: boolean; needTank: boolean }) {
  const { t, lang } = ctx;
  if (needWater) return <p className="rounded-lg bg-amber-100 p-3 text-sm font-semibold">🧮 {t('planNeedWater')}</p>;
  if (!plan || !plan.products.length) return null;
  const n = (x: number) => fmtHa(x, lang);
  return (
    <Card title={`🧮 ${t('planTitle')}`}>
      <div className="space-y-3 text-[15px]">
        {plan.haPerTank !== null && (
          <div>
            <div className="font-extrabold">{t('planFullTank', { l: plan.tankL ?? 0, ha: n(plan.haPerTank) })}</div>
            {plan.metresPerTank !== null && <div className="text-sm text-neutral-700">{t('planMetres', { m: plan.metresPerTank.toLocaleString('lv-LV') })}</div>}
            <ul className="mt-1 divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900">
              {plan.products.map((p) => (
                <li key={p.name} className="flex min-h-11 items-center justify-between gap-3 px-3 py-1">
                  <span className="font-bold">{p.name}</span>
                  <span className="shrink-0 text-lg font-black tabular-nums">{fmtAmount(p.perFullTank!, p.unit, lang)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {needTank && <p className="rounded-lg bg-amber-100 p-2 text-sm font-semibold">{t('planNeedTank')}</p>}
        <div>
          <div className="font-extrabold">{t('planTotal', { ha: n(plan.areaHa), l: plan.totalLiquidL.toLocaleString('lv-LV') })}</div>
          {plan.tankL !== null && (
            <div className="text-sm font-semibold">
              {fillsText(plan.fullTanks, plan.lastTankL, lang)}
            </div>
          )}
          <ul className="mt-1 space-y-0.5 text-sm">
            {plan.products.map((p) => (
              <li key={p.name}>
                <strong>{p.name}:</strong> {t('planProductTotal', { total: fmtAmount(p.total, p.unit, lang), dose: `${n(p.dosePerHa)} ${p.unit}/ha` })}
                {p.lastTank !== null && <> · {t('planLastTank', { a: fmtAmount(p.lastTank, p.unit, lang) })}</>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
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
  const plan = sprayPlan({
    areaHa: totalHa, waterLHa: parseNum(water), tankL: state.machine.tankL, widthM: state.machine.widthM,
    products: chosen.map((p) => ({ name: p.name, dose: parseNum(doseOf(p).dose), unit: doseOf(p).unit })),
  });
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
        field: { id: f.id, name: f.name, areaHa: f.areaHa, plantsPerHa: f.plantsPerHa ?? null, rows: f.rows ?? null, plantingYear: f.plantingYear ?? null, plantingSeason: f.plantingSeason ?? null },
        crop: { id: f.cropId, name: crop ? crop[lang] : '', bbch: f.bbch },
        product: { name: mix.name, regNumber: mix.regNumber ?? '', beeHazard: false, phiDays: null },
        products,
        dose: single ? products[0].dose : products.map((p) => `${p.dose} ${p.doseUnit}`).join(' + '),
        doseUnit: single ? products[0].doseUnit : '',
        waterLHa: water.trim(), purpose: purpose.trim(),
        earliestHarvest: null,
        operator: { ...state.operator }, nozzle: '',
        machine: { ...state.machine }, plan,
        flag: ev.flag, flagReason: ev.decisive ? formatReason(ev.decisive.reason, lang) : FLAG_LABELS[ev.flag][lang],
        checks: ev.checks.map((c) => ({ id: c.id, label: CHECK_LABELS[c.id][lang], status: c.status, reason: formatReason(c.reason, lang) })),
        weather,
        prechecks: [],
        notes: notes.trim(),
        status: 'active',
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
          <Labeled label={t('vehicle')}>
            <input className={inputCls} value={state.machine.vehicle} placeholder={t('vehiclePh')} onChange={(e) => update({ machine: { ...state.machine, vehicle: e.target.value } })} />
          </Labeled>
          <div className="grid grid-cols-2 gap-2">
            <Labeled label={t('tankL')}>
              <NumInput value={state.machine.tankL} decimals={0} min={0} placeholder="l" onChange={(v) => update({ machine: { ...state.machine, tankL: v } })} />
            </Labeled>
            <Labeled label={t('widthM')}>
              <NumInput value={state.machine.widthM} decimals={2} min={0} placeholder="m" onChange={(v) => update({ machine: { ...state.machine, widthM: v } })} />
            </Labeled>
          </div>
        </div>
      </Card>

      <PlanCard ctx={ctx} plan={plan} needWater={chosen.length > 0 && totalHa > 0 && !parseNum(water)} needTank={!!plan && plan.tankL === null} />

      <Labeled label={t('notes')}><textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Labeled>
      {!ready && <div className="text-sm font-semibold text-neutral-700">{chosen.length === 0 ? t('needProduct') : missingDose ? t('needDose') : selFields.length === 0 ? t('pickFields') : ''}</div>}
      <Btn className="w-full !min-h-14 text-lg" disabled={!ready || saving} onClick={save}>{t('start')}</Btn>
      {info && <ProductInfo ctx={ctx} p={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
