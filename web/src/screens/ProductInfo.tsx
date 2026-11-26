import type { Product } from '@spray/shared';
import type { Ctx } from '../App';
import { Btn } from '../ui';

/** Round "i" button that opens a product's information sheet. */
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} aria-label={label}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-neutral-900 bg-white text-lg font-black leading-none">
      i
    </button>
  );
}

function Sheet({ title, onClose, children, closeLabel }: { title: string; onClose: () => void; children: React.ReactNode; closeLabel: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="safe-b mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-extrabold leading-tight">{title}</h2>
          <button onClick={onClose} className="min-h-11 min-w-11 rounded-lg border-2 border-neutral-900 text-lg font-black" aria-label={closeLabel}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Active substances, everything the product controls, and its limits. */
export function ProductInfo({ ctx, p, onClose, onEdit }: { ctx: Ctx; p: Product; onClose: () => void; onEdit?: () => void }) {
  const { t } = ctx;
  const subs = p.activeSubstances ?? [];
  const spec = p.spectrum ?? [];
  const limits = [
    p.minTemp !== null || p.maxTemp !== null ? `${t('pTempRange')}: ${p.minTemp ?? '…'}–${p.maxTemp ?? '…'} °C` : null,
    p.rainFreeHours !== null ? `${t('pRain')}: ${p.rainFreeHours} h` : null,
    p.maxWind !== null ? `${t('pWind')}: ${p.maxWind} m/s` : null,
    p.bbchMin !== null || p.bbchMax !== null ? `BBCH ${p.bbchMin ?? 0}–${p.bbchMax ?? 99}` : null,
    p.defaultDose ? `${t('pDoseShort')}: ${p.defaultDose}` : null,
  ].filter(Boolean);
  return (
    <Sheet title={p.name} onClose={onClose} closeLabel={t('close')}>
      {p.regNumber && <p className="mt-1 text-sm font-semibold text-neutral-700">{t('pReg')}: {p.regNumber}</p>}

      <h3 className="mt-4 text-base font-extrabold">{t('pSubstances')}</h3>
      {subs.length ? (
        <ul className="mt-1 divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900">
          {subs.map((s, i) => (
            <li key={i} className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5">
              <span className="font-bold">{s.name}</span>
              <span className="shrink-0 font-semibold tabular-nums">{s.amount}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-neutral-700">{t('pNotFilled')}</p>}

      <h3 className="mt-4 text-base font-extrabold">{t('pSpectrum')} {spec.length ? <span className="font-semibold text-neutral-600">({spec.length})</span> : null}</h3>
      {spec.length ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {spec.map((s) => <li key={s} className="rounded-full border-2 border-neutral-900 px-2.5 py-1 text-sm font-semibold">{s}</li>)}
        </ul>
      ) : <p className="mt-1 text-sm text-neutral-700">{t('pNotFilled')}</p>}

      {limits.length > 0 && (
        <>
          <h3 className="mt-4 text-base font-extrabold">{t('pLimits')}</h3>
          <ul className="mt-1 list-disc pl-5 text-[15px]">{limits.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
      <p className="mt-3 text-xs text-neutral-600">{t('pInfoSource')}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {onEdit && <Btn kind="ghost" onClick={onEdit}>{t('edit')}</Btn>}
        <Btn className={onEdit ? '' : 'col-span-2'} onClick={onClose}>{t('close')}</Btn>
      </div>
    </Sheet>
  );
}

/** Tick one or more saved products for this spraying (tank mix). */
export function ProductPicker({ ctx, onClose, onInfo }: { ctx: Ctx; onClose: () => void; onInfo: (p: Product) => void }) {
  const { t, state, update } = ctx;
  const sel = state.selectedProductIds;
  const toggle = (id: string) => update((s) => ({
    selectedProductIds: s.selectedProductIds.includes(id) ? s.selectedProductIds.filter((x) => x !== id) : [...s.selectedProductIds, id],
  }));
  return (
    <Sheet title={t('pickProducts')} onClose={onClose} closeLabel={t('close')}>
      <p className="mt-1 text-sm text-neutral-700">{t('pickProductsHint')}</p>
      {state.products.length === 0 ? <p className="mt-3 font-semibold">{t('noProductsGoAdd')}</p> : (
        <ul className="mt-2 divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900">
          {state.products.map((p) => (
            <li key={p.id} className="flex items-center gap-2 pr-2">
              <label className="flex min-h-14 flex-1 cursor-pointer items-center gap-3 px-3 py-1.5">
                <input type="checkbox" className="h-7 w-7 shrink-0 accent-green-700" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="min-w-0">
                  <span className="block font-bold">{p.name}</span>
                  {(p.activeSubstances?.length ?? 0) > 0 && (
                    <span className="block truncate text-sm text-neutral-700">{p.activeSubstances!.map((s) => s.name).join(', ')}</span>
                  )}
                </span>
              </label>
              <InfoButton label={`${p.name} – ${t('pInfo')}`} onClick={() => onInfo(p)} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Btn kind="ghost" disabled={!sel.length} onClick={() => update({ selectedProductIds: [] })}>{t('selectNone')}</Btn>
        <Btn onClick={onClose}>{t('done')}</Btn>
      </div>
    </Sheet>
  );
}
