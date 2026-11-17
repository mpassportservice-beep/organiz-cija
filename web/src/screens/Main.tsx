import { useState } from 'react';
import {
  BBCH_STAGES, CHECK_LABELS, CROPS, FLAG_LABELS, compass, formatReason, type CheckResult, type Reading,
} from '@spray/shared';
import type { Ctx } from '../App';
import { explain } from '../explain';
import { ago, Btn, fmtTime, inputCls, Labeled, NumInput, SourceLine, STATUS_BG, StatusIcon, WindArrow } from '../ui';

const FLAG_HEX = { green: '#15803d', amber: '#fbbf24', red: '#b91c1c' } as const;

function uniqueReadings(rs: Reading[]): Reading[] {
  const seen = new Set<string>();
  return rs.filter((r) => { const k = `${r.source}|${r.station}|${r.time}|${r.fallback}|${r.stale}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function Row({ ch, ctx, onCrop, onInfo }: { ch: CheckResult; ctx: Ctx; onCrop: () => void; onInfo: () => void }) {
  const { lang, t, conditions: c } = ctx;
  const dir = c?.windDir?.value ?? null;
  let right: React.ReactNode = ch.value !== null ? (<><span className="text-2xl font-black tabular-nums">{ch.value}</span><span className="ml-1 text-sm font-semibold">{ch.unit}</span></>) : null;
  if (ch.id === 'wind' && dir !== null)
    right = (<span className="flex items-center gap-1">{right}<span className="ml-1 flex flex-col items-center"><WindArrow fromDeg={dir} /><span className="text-[11px] font-bold">{t('from')} {compass(dir, lang)}</span></span></span>);
  if (ch.id === 'inversion') right = null;
  if (ch.id === 'crop') {
    const crop = CROPS.find((x) => x.id === ctx.rule.crop.cropId);
    right = (<button onClick={onCrop} className="min-h-11 rounded-lg border-2 border-neutral-900 px-3 text-sm font-bold">{crop ? `${crop[lang]}${ctx.rule.crop.bbch !== null ? ` · ${ctx.rule.crop.bbch}` : ''}` : t('choose')}</button>);
  }
  const readings = uniqueReadings(ch.readings);
  return (
    <li className="flex items-start gap-3 border-b border-neutral-300 py-2 last:border-b-0">
      <div className="pt-0.5"><StatusIcon status={ch.status} /></div>
      <button type="button" onClick={onInfo} className="min-w-0 flex-1 text-left" aria-label={`${CHECK_LABELS[ch.id][lang]} – ${t('whatIsThis')}`}>
        <div className="flex items-center gap-1 text-[13px] font-semibold text-neutral-700">
          {CHECK_LABELS[ch.id][lang]}
          <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-neutral-700 text-[11px] font-black leading-none" aria-hidden>i</span>
          {ch.productRule && <span className="ml-1 rounded bg-neutral-900 px-1 text-[10px] font-bold text-white">{t('productLimit')}</span>}
        </div>
        <div className="text-base font-bold leading-tight">{formatReason(ch.reason, lang)}</div>
        {ch.id === 'rain' && c && (
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm font-semibold tabular-nums">
            {c.rain.map((w) => (<span key={w.hours}>{w.hours} h: {w.prob ?? '–'} % · {w.mm === null ? '–' : w.mm.toFixed(1)} mm</span>))}
          </div>
        )}
        {readings.map((r, i) => <SourceLine key={i} r={r} t={t} compact={ch.id === 'deltaT' || ch.id === 'inversion' || ch.id === 'dew'} />)}
        {ch.id === 'frost' && c && (
          <div className="text-[11px] text-neutral-700">
            {c.frostSource === 'obs+forecast' ? `${ctx.snapshot?.observations.find((o) => o.source === 'lvgmc')?.sourceLabel ?? 'LVĢMC'} + ${ctx.snapshot?.forecast.sourceLabel}` : ctx.snapshot?.forecast.sourceLabel}
            {' · '}{ctx.snapshot?.forecast.fetchedAt ? fmtTime(ctx.snapshot.forecast.fetchedAt) : ''}
          </div>
        )}
        {(ch.id === 'deltaT' || ch.id === 'inversion') && <div className="text-[11px] text-neutral-500">{t('calc')}</div>}
      </button>
      <div className="flex shrink-0 items-baseline pt-1">{right}</div>
    </li>
  );
}

function Timeline({ ctx }: { ctx: Ctx }) {
  const { timeline: tl, best, t, lang } = ctx;
  const [sel, setSel] = useState<number | null>(null);
  if (!tl.length) return <div className="rounded-lg border-2 border-neutral-900 p-2 text-sm font-bold">{t('noForecast')}</div>;
  const head = best
    ? `${best.flag === 'green' ? t('bestWindow') : t('bestWindowAmber')}: ${fmtTime(best.start)}–${fmtTime(best.end)}`
    : t('noWindow');
  const picked = sel !== null ? tl[sel] : null;
  return (
    <div>
      <div className="flex items-center gap-2 text-lg font-extrabold leading-tight">
        {best && <StatusIcon status={best.flag} size={22} />}<span>{head}</span>
      </div>
      <div className="mt-1 flex h-9 overflow-hidden rounded-md border-2 border-neutral-900" role="img" aria-label={`${t('next12h')}: ${head}`}>
        {tl.map((s, i) => (
          <button key={s.t} onClick={() => setSel(sel === i ? null : i)} aria-label={`${fmtTime(s.t)} ${FLAG_LABELS[s.flag][lang]}`}
            className="h-full flex-1" style={{
              background: s.flag === 'amber'
                ? `repeating-linear-gradient(135deg, ${FLAG_HEX.amber} 0 4px, #fde68a 4px 7px)` : FLAG_HEX[s.flag],
              boxShadow: sel === i ? 'inset 0 0 0 2px #000' : s.flag === 'red' ? 'inset 0 -6px 0 #450a0a' : undefined,
            }} />
        ))}
      </div>
      <div className="relative mt-0.5 h-4 text-[11px] font-semibold text-neutral-700">
        {(() => {
          let h = 0;
          return tl.map((s, i) => {
            if (new Date(s.t).getUTCMinutes() !== 0) return null;
            const show = h++ % 3 === 0 && i > 1 && i < tl.length - 3;
            return show ? <span key={s.t} className="absolute -translate-x-1/2" style={{ left: `${(i / tl.length) * 100}%` }}>{fmtTime(s.t)}</span> : null;
          });
        })()}
      </div>
      {picked && (
        <div className={`mt-1 rounded-md px-2 py-1 text-sm font-bold ${STATUS_BG[picked.flag]}`}>
          {fmtTime(picked.t)} · {FLAG_LABELS[picked.flag][lang]}{picked.reason ? ` · ${formatReason(picked.reason, lang)}` : ''}
        </div>
      )}
    </div>
  );
}

function InfoSheet({ ctx, ch, onClose }: { ctx: Ctx; ch: CheckResult; onClose: () => void }) {
  const { t, lang, rule } = ctx;
  const rainHours = rule.product?.rainFreeHours ?? rule.thresholds.rainFreeHours;
  const e = explain(ch.id, lang, rule.thresholds, rule.product, rainHours);
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true" aria-label={CHECK_LABELS[ch.id][lang]}>
      <div className="safe-b mx-auto max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-extrabold leading-tight">{CHECK_LABELS[ch.id][lang]}</h2>
          <button onClick={onClose} className="min-h-11 min-w-11 rounded-lg border-2 border-neutral-900 text-lg font-black" aria-label={t('close')}>✕</button>
        </div>
        <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 font-bold ${STATUS_BG[ch.status]}`}>
          <span className="shrink-0 rounded-full bg-white/95 p-0.5"><StatusIcon status={ch.status} size={24} /></span>
          <span>{t('nowLabel')}: {formatReason(ch.reason, lang)}</span>
        </div>
        <h3 className="mt-3 text-base font-extrabold">{t('exWhat')}</h3>
        <p className="mt-0.5 text-[15px] leading-snug">{e.what}</p>
        <h3 className="mt-3 text-base font-extrabold">{t('exWhy')}</h3>
        <p className="mt-0.5 text-[15px] leading-snug">{e.why}</p>
        <h3 className="mt-3 text-base font-extrabold">{t('exRule')}</h3>
        <p className="mt-0.5 text-[15px] leading-snug">{e.rule}</p>
        <p className="mt-1 text-sm text-neutral-600">{t('exEdit')}</p>
        <Btn className="mt-4 w-full" onClick={onClose}>{t('close')}</Btn>
      </div>
    </div>
  );
}

function CropSheet({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { t, lang, rule, update } = ctx;
  const f = rule.field;
  if (!f) return null;
  const set = (patch: object) => update((s) => ({ fields: s.fields.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }));
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={onClose}>
      <div className="safe-b mx-auto w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-extrabold">{f.name}</h2>
        <Labeled label={t('crop')}>
          <select className={inputCls} value={f.cropId ?? ''} onChange={(e) => set({ cropId: e.target.value || null })}>
            <option value="">{t('choose')}</option>
            {CROPS.map((c) => <option key={c.id} value={c.id}>{c[lang]}</option>)}
          </select>
        </Labeled>
        <Labeled label={t('bbch')}>
          <select className={inputCls} value={f.bbch === null ? '' : Math.floor(f.bbch / 10) * 10} onChange={(e) => set({ bbch: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">{t('choose')}</option>
            {BBCH_STAGES.map((b) => <option key={b.code} value={b.code}>{b.code}–{b.code + 9} · {b[lang]}</option>)}
          </select>
        </Labeled>
        <Labeled label={t('bbchExact')}>
          <NumInput value={f.bbch} step="1" onChange={(v) => set({ bbch: v === null ? null : Math.max(0, Math.min(99, Math.round(v))) })} />
        </Labeled>
        <Btn className="w-full" onClick={onClose}>{t('close')}</Btn>
      </div>
    </div>
  );
}

export function Main({ ctx, onStart }: { ctx: Ctx; onStart: () => void }) {
  const { t, lang, state, update, snapshot, evaluation: ev, offline, busy, refresh, now } = ctx;
  const [cropOpen, setCropOpen] = useState(false);
  const [info, setInfo] = useState<CheckResult['id'] | null>(null);
  const infoCheck = info && ev ? ev.checks.find((c) => c.id === info) ?? null : null;
  // Crop stage only matters on the main screen when the chosen product limits the BBCH stage.
  const rows = ev ? ev.checks.filter((c) => c.id !== 'crop' || c.status !== 'info') : [];
  const age = snapshot ? now - Date.parse(snapshot.generatedAt) : 0;
  const ageMin = Math.floor(age / 60_000);
  const usingForecast = !!ctx.conditions && [ctx.conditions.wind, ctx.conditions.temp, ctx.conditions.gust, ctx.conditions.rh].some((r) => r?.fallback || r?.stale);

  return (
    <div className="space-y-2 px-3 pb-3">
      <div className="grid grid-cols-2 gap-2">
        <select aria-label={t('field')} className="min-h-11 w-full rounded-lg border-2 border-neutral-900 bg-white px-2 text-sm font-bold"
          value={ctx.rule.group ? `g:${ctx.rule.group.id}` : state.selectedFieldId ?? ''}
          onChange={(e) => { const v = e.target.value; update(v.startsWith('g:') ? { selectedGroupId: v.slice(2) } : { selectedFieldId: v, selectedGroupId: null }); }}>
          {state.groups.length > 0 && (
            <optgroup label={t('groupsTitle')}>
              {state.groups.map((g) => <option key={g.id} value={`g:${g.id}`}>▦ {g.name} ({g.fieldIds.length})</option>)}
            </optgroup>
          )}
          <optgroup label={t('fieldsTitle')}>
            {state.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </optgroup>
        </select>
        <select aria-label={t('product')} className="min-h-11 w-full rounded-lg border-2 border-neutral-900 bg-white px-2 text-sm font-bold"
          value={state.selectedProductId ?? ''} onChange={(e) => update({ selectedProductId: e.target.value || null })}>
          <option value="">{t('noProduct')}</option>
          {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {offline && <div className="rounded-lg bg-neutral-950 px-3 py-2 text-sm font-bold text-white">⚠ {t('offline')}</div>}
      {!offline && snapshot && ageMin > 25 && <div className="rounded-lg bg-neutral-950 px-3 py-2 text-sm font-bold text-white">⚠ {t('oldData', { min: ageMin })}</div>}

      {!snapshot || !ev ? (
        <div className="rounded-2xl border-2 border-neutral-900 p-6 text-center text-lg font-bold">{ctx.locPending ? t('locLoading') : busy ? t('loading') : t('noDataYet')}</div>
      ) : (
        <>
          <div className={`rounded-2xl px-4 py-4 ${STATUS_BG[ev.flag]}`} role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-white/95 p-1"><StatusIcon status={ev.flag} size={52} /></span>
              <div className="text-[2.4rem] font-black uppercase leading-none tracking-tight">{FLAG_LABELS[ev.flag][lang]}</div>
            </div>
            <div className="mt-2 text-xl font-bold leading-snug">
              {ev.decisive ? formatReason(ev.decisive.reason, lang) : ctx.rule.product ? ctx.rule.product.name : FLAG_LABELS.green[lang]}
            </div>
            {usingForecast && <div className="mt-1 text-sm font-semibold">{t('usingForecast')}</div>}
          </div>

          <Timeline ctx={ctx} />

          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{t('updated', { x: ago(age, lang, t) })} · {fmtTime(snapshot.generatedAt)}</div>
            <button onClick={refresh} disabled={busy} className="min-h-11 rounded-lg border-2 border-neutral-900 px-3 text-sm font-bold disabled:opacity-50">
              <span className={busy ? 'inline-block animate-spin' : 'inline-block'}>↻</span> {t('refresh')}
            </button>
          </div>

          <ul className="rounded-xl border-2 border-neutral-900 px-3">
            {rows.map((ch) => <Row key={ch.id} ch={ch} ctx={ctx} onCrop={() => setCropOpen(true)} onInfo={() => setInfo(ch.id)} />)}
          </ul>

          <Btn className="w-full !min-h-14 text-lg" onClick={onStart}>{t('start')} →</Btn>
        </>
      )}
      {cropOpen && <CropSheet ctx={ctx} onClose={() => setCropOpen(false)} />}
      {infoCheck && <InfoSheet ctx={ctx} ch={infoCheck} onClose={() => setInfo(null)} />}
    </div>
  );
}
