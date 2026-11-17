import { useMemo, useState } from 'react';
import {
  CHECK_LABELS, CROPS, FLAG_LABELS, NOZZLES, compass, deltaT, formatReason, readingKind,
  type LogRecord, type Reading, type WeatherSnapshotItem,
} from '@spray/shared';
import type { Ctx } from '../App';
import { fieldCount } from '../i18n';
import { Btn, Card, Check, downwindHits, FieldMap, inputCls, Labeled, localDateIso, STATUS_BG, StatusIcon } from '../ui';

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
  const { t, lang, state, update, rule, evaluation: ev, conditions } = ctx;
  const p = rule.product;
  const [sel, setSel] = useState<string[]>(() => rule.targetFields.map((x) => x.id));
  const selFields = state.fields.filter((x) => sel.includes(x.id));
  const f = selFields[0] ?? null;
  const toggleField = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const totalHa = selFields.reduce((a, x) => a + (x.areaHa ?? 0), 0);
  const [productName, setProductName] = useState(p?.name ?? '');
  const [dose, setDose] = useState((p?.defaultDose ?? '').replace(/\s*(l|kg|ml|g)\/ha\s*$/i, ''));
  const [unit, setUnit] = useState(UNITS.find((u) => (p?.defaultDose ?? '').toLowerCase().includes(u)) ?? 'l/ha');
  const [water, setWater] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const tick = (k: string) => (v: boolean) => setTicks((s) => ({ ...s, [k]: v }));

  const windFrom = conditions?.windDir?.value ?? null;
  const fieldHits = selFields.map((x) => ({ field: x, hits: downwindHits(x, windFrom) })).filter((x) => x.hits.length > 0);
  const hits = fieldHits.flatMap((x) => x.hits);
  const mapField = fieldHits[0]?.field ?? f;
  const red = ev?.flag === 'red';
  const items = useMemo(() => [
    { id: 'bees', label: t('ckBees') }, { id: 'buffer', label: t('ckBuffer') }, { id: 'nozzle', label: t('ckNozzle') },
    { id: 'sprayer', label: t('ckSprayer') }, { id: 'cert', label: t('ckCert') }, { id: 'soil', label: t('ckSoil') },
    ...(red ? [{ id: 'override', label: t('ckOverride') }] : []),
  ], [t, red]);
  const ready = items.every((i) => ticks[i.id]) && productName.trim() !== '' && dose.trim() !== '' && state.nozzle !== '' && !!ev && selFields.length > 0;

  async function save() {
    if (!ready || !ev || selFields.length === 0) return;
    setSaving(true);
    const now = Date.now();
    const nozzle = NOZZLES.find((n) => n.id === state.nozzle);
    const batchId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const groupName = rule.group && rule.group.fieldIds.every((id) => sel.includes(id)) ? rule.group.name : null;
    const weather = weatherItems(ctx);
    const recs: LogRecord[] = selFields.map((f, i) => {
    const crop = CROPS.find((c) => c.id === f.cropId);
    return {
      id: `${batchId}-${i}`,
      startedAt: new Date(now).toISOString(), endedAt: null,
      field: { id: f.id, name: f.name, areaHa: f.areaHa },
      crop: { id: f.cropId, name: crop ? crop[lang] : '', bbch: f.bbch },
      product: { name: productName.trim(), regNumber: p?.regNumber ?? '', beeHazard: p?.beeHazard ?? false, phiDays: p?.phiDays ?? null },
      dose: dose.trim(), doseUnit: unit, waterLHa: water.trim(), purpose: purpose.trim(),
      earliestHarvest: p?.phiDays != null ? localDateIso(now + p.phiDays * 86_400_000) : null,
      operator: { ...state.operator }, nozzle: nozzle ? nozzle[lang] : '',
      flag: ev.flag, flagReason: ev.decisive ? formatReason(ev.decisive.reason, lang) : FLAG_LABELS[ev.flag][lang],
      checks: ev.checks.map((c) => ({ id: c.id, label: CHECK_LABELS[c.id][lang], status: c.status, reason: formatReason(c.reason, lang) })),
      weather,
      prechecks: items.map((i) => ({ id: i.id, label: i.label, checked: !!ticks[i.id] })),
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
          <Labeled label={t('productName')}><input className={inputCls} value={productName} onChange={(e) => setProductName(e.target.value)} /></Labeled>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Labeled label={t('dose')}><input className={inputCls} inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} /></Labeled>
            <Labeled label=" "><select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Labeled>
          </div>
          <Labeled label={t('water')}><input className={inputCls} inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} /></Labeled>
          <Labeled label={t('purpose')}><input className={inputCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Labeled>
          <div className="grid grid-cols-2 gap-2">
            <Labeled label={t('operator')}><input className={inputCls} value={state.operator.name} onChange={(e) => update({ operator: { ...state.operator, name: e.target.value } })} /></Labeled>
            <Labeled label={t('certificate')}><input className={inputCls} value={state.operator.certificate} onChange={(e) => update({ operator: { ...state.operator, certificate: e.target.value } })} /></Labeled>
          </div>
        </div>
      </Card>

      <h2 className="pt-1 text-lg font-extrabold">{t('checks')}</h2>
      <Check checked={!!ticks.bees} onChange={tick('bees')} title={t('ckBees')} warn={p?.beeHazard}>
        {p?.beeHazard ? <strong>{t('ckBeesHaz')}</strong> : t('ckBeesSafe')}
      </Check>
      <Check checked={!!ticks.buffer} onChange={tick('buffer')} title={t('ckBuffer')} warn={hits.length > 0}>
        <span className="flex items-center gap-3">
          <span className="shrink-0"><FieldMap field={mapField} windFrom={windFrom} lang={lang} size={128} /></span>
          <span>
            {windFrom === null ? t('windUnknown') : t('ckBufferHint', { dir: compass((windFrom + 180) % 360, lang) })}
            {fieldHits.map(({ field: hf, hits: hh }) => (
              <strong key={hf.id} className="mt-1 block text-stop">
                {t('ckBufferWarn', { what: `${selFields.length > 1 ? `${hf.name}: ` : ''}${hh.map((h) => t(`${h}_` as 'water_')).join(', ')}` })}
              </strong>
            ))}
          </span>
        </span>
      </Check>
      <Check checked={!!ticks.nozzle} onChange={tick('nozzle')} title={t('ckNozzle')}>
        <select className={`${inputCls} mt-1`} value={state.nozzle} onClick={(e) => e.preventDefault()} onChange={(e) => update({ nozzle: e.target.value })}>
          <option value="">{t('choose')}</option>
          {NOZZLES.map((n) => <option key={n.id} value={n.id}>{n[lang]}</option>)}
        </select>
      </Check>
      <Check checked={!!ticks.sprayer} onChange={tick('sprayer')} title={t('ckSprayer')} />
      <Check checked={!!ticks.cert} onChange={tick('cert')} title={t('ckCert')} />
      <Check checked={!!ticks.soil} onChange={tick('soil')} title={t('ckSoil')} />
      {red && <Check checked={!!ticks.override} onChange={tick('override')} title={t('ckOverride')} warn />}

      <Labeled label={t('notes')}><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Labeled>
      {!ready && <div className="text-sm font-semibold text-neutral-700">{t('needAll')}</div>}
      <Btn className="w-full !min-h-14 text-lg" disabled={!ready || saving} onClick={save}>{t('start')}</Btn>
    </div>
  );
}
