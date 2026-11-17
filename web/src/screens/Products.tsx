import { useState } from 'react';
import { DEMO } from '../demo';
import type { Product } from '@spray/shared';
import type { Ctx } from '../App';
import { Btn, Card, inputCls, Labeled, NumInput } from '../ui';

const blank = (): Product => ({
  id: `p${Date.now().toString(36)}`, name: '', minTemp: null, maxTemp: null, rainFreeHours: null, maxWind: null,
  beeHazard: false, phiDays: null, bbchMin: null, bbchMax: null, regNumber: '', defaultDose: '',
});

function Editor({ ctx, initial, onClose }: { ctx: Ctx; initial: Product; onClose: () => void }) {
  const { t, state, update } = ctx;
  const [p, setP] = useState(initial);
  const set = (patch: Partial<Product>) => setP((x) => ({ ...x, ...patch }));
  const exists = state.products.some((x) => x.id === p.id);
  const save = () => {
    update((s) => ({ products: exists ? s.products.map((x) => (x.id === p.id ? p : x)) : [...s.products, p] }));
    onClose();
  };
  const d = t('emptyDefault');
  return (
    <Card title={exists ? p.name : t('addProduct')}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (p.name.trim()) save(); }}>
        <Labeled label={t('pName')}><input className={inputCls} required value={p.name} onChange={(e) => set({ name: e.target.value })} /></Labeled>
        <Labeled label={t('pReg')}><input className={inputCls} value={p.regNumber ?? ''} onChange={(e) => set({ regNumber: e.target.value })} /></Labeled>
        <div className="grid grid-cols-2 gap-2">
          <Labeled label={t('pMinTemp')}><NumInput value={p.minTemp} onChange={(v) => set({ minTemp: v })} placeholder={d} /></Labeled>
          <Labeled label={t('pMaxTemp')}><NumInput value={p.maxTemp} onChange={(v) => set({ maxTemp: v })} placeholder={d} /></Labeled>
          <Labeled label={t('pRain')}><NumInput value={p.rainFreeHours} onChange={(v) => set({ rainFreeHours: v === null ? null : Math.max(0, v) })} placeholder={d} /></Labeled>
          <Labeled label={t('pWind')}><NumInput value={p.maxWind} onChange={(v) => set({ maxWind: v })} placeholder={d} /></Labeled>
          <Labeled label={t('pBbchMin')}><NumInput value={p.bbchMin} step="1" onChange={(v) => set({ bbchMin: v })} /></Labeled>
          <Labeled label={t('pBbchMax')}><NumInput value={p.bbchMax} step="1" onChange={(v) => set({ bbchMax: v })} /></Labeled>
        </div>
        <Labeled label={t('pPhi')}><NumInput value={p.phiDays} step="1" onChange={(v) => set({ phiDays: v })} /></Labeled>
        <Labeled label={t('pDose')}><input className={inputCls} value={p.defaultDose ?? ''} onChange={(e) => set({ defaultDose: e.target.value })} /></Labeled>
        <label className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-neutral-900 px-3">
          <input type="checkbox" className="h-7 w-7 accent-red-700" checked={p.beeHazard} onChange={(e) => set({ beeHazard: e.target.checked })} />
          <span className="font-bold">{t('pBee')}</span>
        </label>
        <div className="flex gap-2">
          <Btn type="submit" className="flex-1">{t('save')}</Btn>
          <Btn kind="ghost" onClick={onClose}>{t('cancel')}</Btn>
        </div>
        {exists && (
          <Btn kind="danger" className="w-full" onClick={() => {
            if (!DEMO && !confirm(`${t('delete')}: ${p.name}?`)) return;
            update((s) => ({ products: s.products.filter((x) => x.id !== p.id), selectedProductId: s.selectedProductId === p.id ? null : s.selectedProductId }));
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
  if (editing) return <div className="px-3 pb-6"><Editor ctx={ctx} initial={editing} onClose={() => setEditing(null)} /></div>;
  return (
    <div className="space-y-3 px-3 pb-6">
      <h1 className="text-2xl font-black">{t('productsTitle')}</h1>
      <p className="text-sm text-neutral-700">{t('productsHint')}</p>
      {state.products.length === 0 && <p className="font-semibold">{t('noProducts')}</p>}
      {state.products.map((p) => {
        const sel = state.selectedProductId === p.id;
        const facts = [
          p.minTemp !== null || p.maxTemp !== null ? `${p.minTemp ?? '…'}–${p.maxTemp ?? '…'} °C` : null,
          p.rainFreeHours !== null ? `${p.rainFreeHours} h ☂` : null,
          p.maxWind !== null ? `≤ ${p.maxWind} m/s` : null,
          p.bbchMin !== null || p.bbchMax !== null ? `BBCH ${p.bbchMin ?? 0}–${p.bbchMax ?? 99}` : null,
          p.phiDays !== null ? `${p.phiDays} d` : null,
        ].filter(Boolean);
        return (
          <div key={p.id} className={`rounded-xl border-2 p-3 ${sel ? 'border-go bg-green-50' : 'border-neutral-900'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-lg font-extrabold">{p.name}</div>
                <div className="text-sm font-semibold text-neutral-700">{facts.join(' · ') || '—'}</div>
                {p.beeHazard && <span className="mt-1 inline-block rounded bg-stop px-1.5 py-0.5 text-xs font-bold text-white">⚠ {t('bee')}</span>}
              </div>
              {sel && <span className="rounded bg-go px-1.5 py-0.5 text-xs font-bold text-white">{t('selected')}</span>}
            </div>
            <div className="mt-2 flex gap-2">
              <Btn className="flex-1" kind={sel ? 'ghost' : 'primary'} onClick={() => update({ selectedProductId: sel ? null : p.id })}>{sel ? t('deselect') : t('select')}</Btn>
              <Btn kind="ghost" onClick={() => setEditing(p)}>{t('edit')}</Btn>
            </div>
          </div>
        );
      })}
      <Btn className="w-full" onClick={() => setEditing(blank())}>+ {t('addProduct')}</Btn>
    </div>
  );
}
