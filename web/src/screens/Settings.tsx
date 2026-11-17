import { useEffect, useState } from 'react';
import { DEMO } from '../demo';
import { CROPS, DEFAULT_THRESHOLDS, THRESHOLD_GROUPS, type Field, type FieldGroup, type Thresholds } from '@spray/shared';
import type { Ctx } from '../App';
import { pushCurrent, pushDisable, pushEnable, pushSupported, pushTest } from '../data';
import { fieldCount, THRESHOLD_LABELS, type Key } from '../i18n';
import { ago, Btn, Card, fmtTime, inputCls, Labeled, NumInput } from '../ui';

function FieldEditor({ ctx, f }: { ctx: Ctx; f: Field }) {
  const { t, lang, state, update } = ctx;
  const set = (patch: Partial<Field>) => update((s) => ({ fields: s.fields.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }));
  return (
    <div className="space-y-3 rounded-xl border-2 border-neutral-900 p-3">
      <div className="grid grid-cols-[1fr_6.5rem] gap-2">
        <Labeled label={t('fieldName')}><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Labeled>
        <Labeled label={t('area')}><NumInput value={f.areaHa} decimals={2} min={0} placeholder="0,00" onChange={(v) => set({ areaHa: v === null ? null : Math.round(v * 100) / 100 })} /></Labeled>
      </div>
      <div className="grid grid-cols-[1fr_6.5rem] gap-2">
        <Labeled label={t('crop')}>
          <select className={inputCls} value={f.cropId ?? ''} onChange={(e) => set({ cropId: e.target.value || null })}>
            <option value="">{t('choose')}</option>
            {CROPS.map((c) => <option key={c.id} value={c.id}>{c[lang]}</option>)}
          </select>
        </Labeled>
        <Labeled label="BBCH"><NumInput value={f.bbch} step="1" onChange={(v) => set({ bbch: v === null ? null : Math.max(0, Math.min(99, Math.round(v))) })} /></Labeled>
      </div>
      {state.fields.length > 1 && (
        <Btn kind="danger" className="w-full" onClick={() => {
          if (!DEMO && !confirm(`${t('delete')}: ${f.name}?`)) return;
          update((s) => {
            const fields = s.fields.filter((x) => x.id !== f.id);
            const groups = s.groups.map((g) => ({ ...g, fieldIds: g.fieldIds.filter((id) => id !== f.id) }));
            return { fields, groups, selectedFieldId: s.selectedFieldId === f.id ? fields[0].id : s.selectedFieldId };
          });
        }}>{t('delete')}</Btn>
      )}
    </div>
  );
}

function GroupEditor({ ctx, g, onClose }: { ctx: Ctx; g: FieldGroup; onClose: () => void }) {
  const { t, state, update } = ctx;
  const set = (patch: Partial<FieldGroup>) => update((s) => ({ groups: s.groups.map((x) => (x.id === g.id ? { ...x, ...patch } : x)) }));
  const toggle = (id: string) => set({ fieldIds: g.fieldIds.includes(id) ? g.fieldIds.filter((x) => x !== id) : [...g.fieldIds, id] });
  const area = state.fields.filter((f) => g.fieldIds.includes(f.id)).reduce((a, f) => a + (f.areaHa ?? 0), 0);
  return (
    <div className="space-y-3 rounded-xl border-2 border-neutral-900 p-3">
      <Labeled label={t('groupName')}><input className={inputCls} value={g.name} onChange={(e) => set({ name: e.target.value })} /></Labeled>
      <div>
        <div className="mb-1 flex items-center justify-between text-sm font-semibold">
          <span>{t('groupFields')}: {fieldCount(g.fieldIds.length, ctx.lang)}{area > 0 ? ` · ${Math.round(area * 100) / 100} ha` : ''}</span>
          <span className="flex gap-1">
            <button className="min-h-9 rounded-md border-2 border-neutral-900 px-2 font-bold" onClick={() => set({ fieldIds: state.fields.map((f) => f.id) })}>{t('selectAll')}</button>
            <button className="min-h-9 rounded-md border-2 border-neutral-900 px-2 font-bold" onClick={() => set({ fieldIds: [] })}>{t('selectNone')}</button>
          </span>
        </div>
        <ul className="divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900">
          {state.fields.map((f) => (
            <li key={f.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3">
                <input type="checkbox" className="h-7 w-7 shrink-0 accent-green-700" checked={g.fieldIds.includes(f.id)} onChange={() => toggle(f.id)} />
                <span className="font-bold">{f.name}{f.areaHa ? ` · ${f.areaHa} ha` : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Btn kind="danger" onClick={() => {
          if (!DEMO && !confirm(`${t('delete')}: ${g.name}?`)) return;
          update((s) => ({ groups: s.groups.filter((x) => x.id !== g.id), selectedGroupId: s.selectedGroupId === g.id ? null : s.selectedGroupId }));
          onClose();
        }}>{t('delete')}</Btn>
        <Btn kind="ghost" onClick={onClose}>{t('close')}</Btn>
      </div>
    </div>
  );
}

function Notifications({ ctx }: { ctx: Ctx }) {
  const { t, lang } = ctx;
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { void pushCurrent().then((s) => setOn(!!s)); }, []);
  if (!pushSupported()) return <p className="text-sm font-semibold">{t('notifUnsupported')}</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm">{t('notifHint')}</p>
      {on ? (
        <div className="flex gap-2">
          <Btn kind="ghost" className="flex-1" onClick={async () => { await pushDisable(); setOn(false); }}>{t('notifDisable')}</Btn>
          <Btn className="flex-1" onClick={async () => setMsg((await pushTest(lang)) ? '✓' : '✕')}>{t('notifTest')} {msg}</Btn>
        </div>
      ) : (
        <Btn className="w-full" onClick={async () => { const r = await pushEnable(lang); setOn(r === 'ok'); setMsg(r === 'denied' ? t('notifDenied') : r === 'error' ? '✕' : ''); }}>{t('notifEnable')}</Btn>
      )}
      {!on && msg && <p className="text-sm font-bold text-stop">{msg}</p>}
    </div>
  );
}

export function Settings({ ctx }: { ctx: Ctx }) {
  const { t, lang, state, update, snapshot, now } = ctx;
  const [openField, setOpenField] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const setT = (k: keyof Thresholds, v: number | null) => update((s) => {
    const th = { ...s.thresholds };
    if (v === null || v === DEFAULT_THRESHOLDS[k]) delete th[k]; else th[k] = v;
    return { thresholds: th };
  });
  return (
    <div className="space-y-3 px-3 pb-6">
      <h1 className="text-2xl font-black">{t('tabSettings')}</h1>

      <Card title={t('language')}>
        <div className="grid grid-cols-2 gap-2">
          {(['lv', 'en'] as const).map((l) => (
            <Btn key={l} kind={lang === l ? 'primary' : 'ghost'} onClick={() => update({ lang: l })}>{l === 'lv' ? 'Latviešu' : 'English'}</Btn>
          ))}
        </div>
      </Card>

      <Card title={t('operatorTitle')}>
        <div className="space-y-3">
          <Labeled label={t('name')}><input className={inputCls} value={state.operator.name} onChange={(e) => update({ operator: { ...state.operator, name: e.target.value } })} /></Labeled>
          <Labeled label={t('certificate')}><input className={inputCls} value={state.operator.certificate} onChange={(e) => update({ operator: { ...state.operator, certificate: e.target.value } })} /></Labeled>
        </div>
      </Card>

      <Card title={t('fieldsTitle')}>
        <div className="space-y-2">
          {state.fields.map((f) => (openField === f.id ? (
            <div key={f.id}>
              <FieldEditor ctx={ctx} f={f} />
              <Btn kind="ghost" className="mt-2 w-full" onClick={() => setOpenField(null)}>{t('close')}</Btn>
            </div>
          ) : (
            <button key={f.id} className="flex min-h-12 w-full items-center justify-between rounded-lg border-2 border-neutral-900 px-3 text-left font-bold" onClick={() => setOpenField(f.id)}>
              <span>{f.name}{f.areaHa ? ` · ${f.areaHa} ha` : ''}{f.cropId ? ` · ${CROPS.find((c) => c.id === f.cropId)?.[lang]}` : ''}</span><span aria-hidden>✎</span>
            </button>
          )))}
          <Btn className="w-full" onClick={() => {
            const id = `f${Date.now().toString(36)}`;
            update((s) => ({ fields: [...s.fields, { id, name: `${t('field')} ${s.fields.length + 1}`, areaHa: null, cropId: null, bbch: null, water: [], neighbours: [], hives: [] }] }));
            setOpenField(id);
          }}>+ {t('addField')}</Btn>
        </div>
      </Card>

      <Card title={t('groupsTitle')}>
        <p className="mb-2 text-sm text-neutral-700">{t('groupsHint')}</p>
        <div className="space-y-2">
          {state.groups.map((g) => (openGroup === g.id ? (
            <GroupEditor key={g.id} ctx={ctx} g={g} onClose={() => setOpenGroup(null)} />
          ) : (
            <button key={g.id} className="flex min-h-12 w-full items-center justify-between rounded-lg border-2 border-neutral-900 px-3 text-left font-bold" onClick={() => setOpenGroup(g.id)}>
              <span>▦ {g.name} · {fieldCount(g.fieldIds.length, lang)}</span><span aria-hidden>✎</span>
            </button>
          )))}
          {state.fields.length < 2 && <p className="text-sm font-semibold">{t('needTwoFields')}</p>}
          <Btn className="w-full" disabled={state.fields.length < 2} onClick={() => {
            const id = `g${Date.now().toString(36)}`;
            update((s) => ({ groups: [...s.groups, { id, name: `${t('groupDefault')} ${s.groups.length + 1}`, fieldIds: [] }] }));
            setOpenGroup(id);
          }}>+ {t('addGroup')}</Btn>
        </div>
      </Card>

      <Card title={t('notifTitle')}><Notifications ctx={ctx} /></Card>

      <Card title={t('thresholdsTitle')}>
        <p className="mb-2 text-sm text-neutral-700">{t('thresholdsHint')}</p>
        {THRESHOLD_GROUPS.map((g) => (
          <details key={g.id} className="border-t border-neutral-300 py-1">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold">
              {t(`g_${g.id}` as Key)}
              {g.keys.some((k) => state.thresholds[k.key] !== undefined) && <span className="ml-2 rounded bg-amber-200 px-1 text-xs">●</span>}
            </summary>
            <div className="space-y-2 pb-2">
              {g.keys.map(({ key, unit }) => (
                <Labeled key={key} label={`${THRESHOLD_LABELS[key][lang]}, ${unit}`} hint={`${DEFAULT_THRESHOLDS[key]}`}>
                  <NumInput value={state.thresholds[key] ?? null} placeholder={String(DEFAULT_THRESHOLDS[key])} highlight={state.thresholds[key] !== undefined} onChange={(v) => setT(key, v)} />
                </Labeled>
              ))}
            </div>
          </details>
        ))}
        <Btn kind="ghost" className="mt-2 w-full" disabled={Object.keys(state.thresholds).length === 0} onClick={() => update({ thresholds: {} })}>{t('resetAll')}</Btn>
      </Card>

      <Card title={t('sourcesTitle')}>
        {snapshot && (
          <ul className="space-y-2 text-sm">
            <li><strong>{t('farm')}:</strong> {snapshot.farm.name} · {snapshot.farm.lat}, {snapshot.farm.lon}</li>
            {snapshot.sources.map((s) => (
              <li key={s.id} className="rounded-lg border border-neutral-400 p-2">
                <div className="font-bold">{s.ok ? '✓' : '✕'} {s.label} — {s.ok ? t('srcOk') : t('srcFail')}</div>
                {s.detail && s.ok && <div>{s.detail}</div>}
                {s.error && <div className="break-words text-stop">{s.error}</div>}
                <div className="text-neutral-700">{t('srcLast')}: {s.fetchedAt ? `${fmtTime(s.fetchedAt)} (${ago(now - Date.parse(s.fetchedAt), lang, t)})` : t('srcNever')}</div>
              </li>
            ))}
            {snapshot.observations.map((o) => (
              <li key={o.source + o.stationId} className="text-neutral-800">{o.sourceLabel} · {o.station} · {o.distanceKm ?? '?'} km · {fmtTime(o.time)}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
