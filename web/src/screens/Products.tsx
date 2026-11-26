import { useState } from 'react';
import { DEMO } from '../demo';
import { parseSubstance, splitList, type Product } from '@spray/shared';
import { InfoButton, ProductInfo } from './ProductInfo';
import type { Ctx } from '../App';
import { Btn, Card, inputCls, Labeled, NumInput } from '../ui';

const blank = (): Product => ({
  id: `p${Date.now().toString(36)}`, name: '', minTemp: null, maxTemp: null, rainFreeHours: null, maxWind: null,
  beeHazard: false, phiDays: null, bbchMin: null, bbchMax: null, regNumber: '', defaultDose: '', activeSubstances: [], spectrum: [],
});

const subsText = (p: Product) => (p.activeSubstances ?? []).map((s) => (s.amount ? `${s.name} ${s.amount}` : s.name)).join('\n');

function Editor({ ctx, initial, onClose }: { ctx: Ctx; initial: Product; onClose: () => void }) {
  const { t, state, update } = ctx;
  const [p, setP] = useState(initial);
  const [subs, setSubs] = useState(subsText(initial));
  const [spec, setSpec] = useState((initial.spectrum ?? []).join('\n'));
  const set = (patch: Partial<Product>) => setP((x) => ({ ...x, ...patch }));
  const exists = state.products.some((x) => x.id === p.id);
  const save = () => {
    const done: Product = {
      ...p, name: p.name.trim(),
      activeSubstances: subs.split('\n').map(parseSubstance).filter((x): x is NonNullable<typeof x> => !!x),
      spectrum: splitList(spec),
    };
    update((s) => ({ products: exists ? s.products.map((x) => (x.id === p.id ? done : x)) : [...s.products, done] }));
    onClose();
  };
  const d = t('emptyDefault');
  return (
    <Card title={exists ? p.name : t('addProduct')}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (p.name.trim()) save(); }}>
        <Labeled label={t('pName')}><input className={inputCls} required value={p.name} onChange={(e) => set({ name: e.target.value })} /></Labeled>
        <Labeled label={t('pReg')}><input className={inputCls} value={p.regNumber ?? ''} onChange={(e) => set({ regNumber: e.target.value })} /></Labeled>
        <Labeled label={t('pSubstances')} hint={t('pSubstancesHint')}>
          <textarea className={inputCls} rows={2} value={subs} placeholder={'MCPA 750 g/l'} onChange={(e) => setSubs(e.target.value)} />
        </Labeled>
        <Labeled label={t('pSpectrum')} hint={t('pSpectrumHint')}>
          <textarea className={inputCls} rows={4} value={spec} placeholder={t('pSpectrumPh')} onChange={(e) => setSpec(e.target.value)} />
        </Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t('pMinTemp')}><NumInput value={p.minTemp} onChange={(v) => set({ minTemp: v })} placeholder={d} /></Labeled>
          <Labeled label={t('pMaxTemp')}><NumInput value={p.maxTemp} onChange={(v) => set({ maxTemp: v })} placeholder={d} /></Labeled>
          <Labeled label={t('pRain')}><NumInput value={p.rainFreeHours} onChange={(v) => set({ rainFreeHours: v === null ? null : Math.max(0, v) })} placeholder={d} /></Labeled>
          <Labeled label={t('pWind')}><NumInput value={p.maxWind} onChange={(v) => set({ maxWind: v })} placeholder={d} /></Labeled>
          <Labeled label={t('pBbchMin')}><NumInput value={p.bbchMin} step="1" onChange={(v) => set({ bbchMin: v })} /></Labeled>
          <Labeled label={t('pBbchMax')}><NumInput value={p.bbchMax} step="1" onChange={(v) => set({ bbchMax: v })} /></Labeled>
        </div>
        <Labeled label={t('pDose')}><input className={inputCls} value={p.defaultDose ?? ''} onChange={(e) => set({ defaultDose: e.target.value })} /></Labeled>
        <div className="flex gap-2">
          <Btn type="submit" className="flex-1">{t('save')}</Btn>
          <Btn kind="ghost" onClick={onClose}>{t('cancel')}</Btn>
        </div>
        {exists && (
          <Btn kind="danger" className="w-full" onClick={() => {
            if (!DEMO && !confirm(`${t('delete')}: ${p.name}?`)) return;
            update((s) => ({ products: s.products.filter((x) => x.id !== p.id), selectedProductIds: s.selectedProductIds.filter((x) => x !== p.id) }));
            onClose();
          }}>{t('delete')}</Btn>
        )}
      </form>
    </Card>
  );
}

export function Products({ ctx }: { ctx: Ctx }) {
  const { t, state, update } = ctx;
  const [editing, setEditing] = useState<Product | null>(null);
  const [info, setInfo] = useState<Product | null>(null);
  if (editing) return <div className="px-3 pb-6"><Editor ctx={ctx} initial={editing} onClose={() => setEditing(null)} /></div>;
  return (
    <div className="space-y-3 px-3 pb-6">
      <h1 className="text-2xl font-black">{t('productsTitle')}</h1>
      <p className="text-sm text-neutral-700">{t('productsHint')}</p>
      {state.products.length === 0 && <p className="font-semibold">{t('noProducts')}</p>}
      {state.products.map((p) => {
        const sel = state.selectedProductIds.includes(p.id);
        const facts = [
          p.minTemp !== null || p.maxTemp !== null ? `${p.minTemp ?? '…'}–${p.maxTemp ?? '…'} °C` : null,
          p.rainFreeHours !== null ? `${p.rainFreeHours} h ☂` : null,
          p.maxWind !== null ? `≤ ${p.maxWind} m/s` : null,
          p.bbchMin !== null || p.bbchMax !== null ? `BBCH ${p.bbchMin ?? 0}–${p.bbchMax ?? 99}` : null,
        ].filter(Boolean);
        return (
          <div key={p.id} className={`rounded-xl border-2 p-3 ${sel ? 'border-go bg-green-50' : 'border-neutral-900'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-lg font-extrabold">{p.name}</div>
                {(p.activeSubstances?.length ?? 0) > 0 && (
                  <div className="text-sm font-semibold">{p.activeSubstances!.map((x) => (x.amount ? `${x.name} ${x.amount}` : x.name)).join(' + ')}</div>
                )}
                <div className="text-sm font-semibold text-neutral-700">{facts.join(' · ') || '—'}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <InfoButton label={`${p.name} – ${t('pInfo')}`} onClick={() => setInfo(p)} />
                {sel && <span className="rounded bg-go px-1.5 py-0.5 text-xs font-bold text-white">{t('selected')}</span>}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Btn className="flex-1" kind={sel ? 'ghost' : 'primary'} onClick={() => update((s) => ({ selectedProductIds: sel ? s.selectedProductIds.filter((x) => x !== p.id) : [...s.selectedProductIds, p.id] }))}>{sel ? t('deselect') : t('select')}</Btn>
              <Btn kind="ghost" onClick={() => setEditing(p)}>{t('edit')}</Btn>
            </div>
          </div>
        );
      })}
      <Btn className="w-full" onClick={() => setEditing(blank())}>+ {t('addProduct')}</Btn>
      {info && <ProductInfo ctx={ctx} p={info} onClose={() => setInfo(null)} onEdit={() => { setEditing(info); setInfo(null); }} />}
    </div>
  );
}
