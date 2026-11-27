import { useEffect, useState } from 'react';
import { durationMin, isActive, plantingAge, type LogRecord } from '@spray/shared';
import type { Ctx } from '../App';
import { DEMO } from '../demo';
import { Btn, fmtDate, fmtHa, fmtTime, STATUS_BG } from '../ui';
import { fmtAmount } from './Precheck';
import { weatherItems } from '../weather';

/** "26.11.2026 · 19:49–23:30 · P4-1 · 10,82 ha" */
export function logTitle(r: LogRecord, lang: 'lv' | 'en'): string {
  return [
    fmtDate(r.startedAt),
    `${fmtTime(r.startedAt)}${r.endedAt ? `–${fmtTime(r.endedAt)}` : ''}`,
    r.field.name,
    r.field.areaHa ? `${fmtHa(r.field.areaHa, lang)} ha` : null,
  ].filter(Boolean).join(' · ');
}

/** "1:05:09" */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Ticks every second while a spraying is running. */
function useClock(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

/** Running sprayings, one card per "Sākt smidzināšanu" (all its fields together). */
export function activeGroups(logs: LogRecord[]): LogRecord[][] {
  const groups = new Map<string, LogRecord[]>();
  for (const r of logs) {
    const key = r.batch?.id ?? r.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.values()]
    .filter((g) => g.some(isActive))
    .map((g) => g.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })));
}

function ActiveSpraying({ ctx, group }: { ctx: Ctx; group: LogRecord[] }) {
  const { t, lang } = ctx;
  const now = useClock(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const first = group[0];
  const running = group.filter(isActive);
  const done = group.filter((r) => !isActive(r));
  const finish = async (recs: LogRecord[]) => {
    setBusy(true); setErr('');
    const end = new Date().toISOString();
    const weatherEnd = weatherItems(ctx);
    await ctx.addLog(recs.map((r) => ({ ...r, status: 'done' as const, endedAt: end, weatherEnd })));
    setBusy(false);
  };
  const cancel = async () => {
    if (!DEMO && !confirm(t('sprayCancelConfirm'))) return;
    setBusy(true);
    if (!(await ctx.removeLogs(running.map((r) => r.id)))) setErr(t('sprayCancelOffline'));
    setBusy(false);
  };
  const ha = running.reduce((a, r) => a + (r.field.areaHa ?? 0), 0);
  return (
    <section className="rounded-xl border-[3px] border-go bg-green-50 p-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-lg font-black">
          <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-go opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-go" /></span>
          {t('sprayRunning')}
        </div>
        <div className="text-2xl font-black tabular-nums">{clock(now - Date.parse(first.startedAt))}</div>
      </div>
      <div className="mt-1 text-sm font-semibold">
        {t('sprayStartedAt')} {fmtTime(first.startedAt)} · {first.product.name}{first.batch?.group ? ` · ▦ ${first.batch.group}` : ''}
      </div>
      <ul className="mt-2 divide-y divide-neutral-300 rounded-lg border-2 border-neutral-900 bg-white">
        {group.map((r) => (
          <li key={r.id} className="flex min-h-14 items-center justify-between gap-2 px-3 py-1.5">
            <span className="min-w-0">
              <span className="block font-bold">{r.field.name}{r.field.areaHa ? ` · ${String(r.field.areaHa).replace('.', lang === 'lv' ? ',' : '.')} ha` : ''}</span>
              {!isActive(r) && r.endedAt && (
                <span className="block text-sm font-semibold text-go">✓ {t('fieldDoneAt', { time: fmtTime(r.endedAt), min: durationMin(r) ?? 0 })}</span>
              )}
              {ctx.pendingLogs.has(r.id) && <span className="mt-0.5 inline-block rounded bg-neutral-900 px-1.5 text-xs font-bold text-white">{t('notSynced')}</span>}
            </span>
            {isActive(r) && (
              <button disabled={busy} onClick={() => void finish([r])}
                className="min-h-12 shrink-0 rounded-lg bg-go px-3 text-sm font-black text-white disabled:opacity-50">✓ {t('fieldDone')}</button>
            )}
          </li>
        ))}
      </ul>
      {running.length > 1 && (
        <Btn className="mt-2 w-full !min-h-14 !bg-go text-lg" disabled={busy} onClick={() => void finish(running)}>
          ✓ {t('finishAll', { n: running.length })}{ha > 0 ? ` · ${String(Math.round(ha * 100) / 100).replace('.', lang === 'lv' ? ',' : '.')} ha` : ''}
        </Btn>
      )}
      {done.length > 0 && <p className="mt-2 text-sm font-semibold">{t('fieldsLeft', { done: done.length, all: group.length })}</p>}
      <button className="mt-2 min-h-11 w-full rounded-lg border-2 border-stop bg-white text-sm font-bold text-stop disabled:opacity-50" disabled={busy} onClick={() => void cancel()}>
        {t('sprayCancel')}
      </button>
      {err && <p className="mt-2 rounded-lg bg-stop px-3 py-2 text-sm font-bold text-white">{err}</p>}
    </section>
  );
}

export function Log({ ctx }: { ctx: Ctx }) {
  const { t, lang, logs: all, pendingLogs } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  const running = activeGroups(all);
  // The register lists only finished fields; running ones are in the cards above.
  const logs = all.filter((r) => !isActive(r));
  return (
    <div className="space-y-3 px-3 pb-6">
      <h1 className="text-2xl font-black">{t('logTitle')}</h1>
      {running.map((g) => <ActiveSpraying key={g[0].batch?.id ?? g[0].id} ctx={ctx} group={g} />)}
      {DEMO && <p className="rounded-lg bg-neutral-200 px-3 py-2 text-sm font-semibold">{lang === 'lv' ? 'Priekšskatījumā CSV/PDF eksports nav pieejams – tas darbojas īstajā lietotnē.' : 'CSV/PDF export is not available in this preview – it works in the real app.'}</p>}
      <div className={`grid grid-cols-2 gap-2 ${DEMO ? 'hidden' : ''}`}>
        <a className="flex min-h-12 items-center justify-center rounded-lg border-2 border-neutral-900 font-bold" href={`/api/logs.csv?lang=${lang}`} download>{t('exportCsv')}</a>
        <a className="flex min-h-12 items-center justify-center rounded-lg border-2 border-neutral-900 font-bold" href={`/api/logs.pdf?lang=${lang}`} download>{t('exportPdf')}</a>
      </div>
      {logs.length === 0 && running.length === 0 && <p className="font-semibold">{t('logEmpty')}</p>}
      {logs.map((r) => (
        <div key={r.id} className="rounded-xl border-2 border-neutral-900">
          <button className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
            <span className={`mt-1 rounded px-1.5 py-0.5 text-xs font-black uppercase ${STATUS_BG[r.flag]}`}>{r.flag === 'green' ? '✓' : r.flag === 'amber' ? '!' : '✕'}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">{logTitle(r, lang)}</span>
              <span className="block text-sm font-semibold">{r.product.name} · {r.dose}{r.doseUnit ? ` ${r.doseUnit}` : ''}{r.crop.name ? ` · ${r.crop.name}` : ''}{r.crop.bbch !== null ? ` BBCH ${r.crop.bbch}` : ''}</span>
              {pendingLogs.has(r.id) && <span className="mt-1 inline-block rounded bg-neutral-900 px-1.5 text-xs font-bold text-white">{t('notSynced')}</span>}
            </span>
            <span className="text-xl" aria-hidden>{open === r.id ? '▴' : '▾'}</span>
          </button>
          {open === r.id && (
            <div className="space-y-2 border-t-2 border-neutral-900 p-3 text-sm">
              {r.recordedBy && <div><strong>{t('recordedBy')}:</strong> {r.recordedBy.name || r.recordedBy.email}</div>}
              {(r.field.plantsPerHa || r.field.rows || r.field.plantingYear) && (
                <div><strong>{t('field')}:</strong> {[r.field.plantingYear ? `${t('plantingYear').toLowerCase()} ${r.field.plantingYear} (${plantingAge(r.field.plantingYear, new Date(r.startedAt), lang)})` : null,
                  r.field.rows ? `${r.field.rows} ${t('rowsShort')}` : null, r.field.plantsPerHa ? `${r.field.plantsPerHa.toLocaleString('lv-LV')} ${t('plantsShort')}` : null].filter(Boolean).join(' · ')}</div>
              )}
              {r.machine && (r.machine.vehicle || r.machine.tankL || r.machine.widthM) && (
                <div><strong>{t('vehicle')}:</strong> {[r.machine.vehicle || null, r.machine.tankL ? `${r.machine.tankL} l` : null, r.machine.widthM ? `${fmtHa(r.machine.widthM, lang)} m` : null].filter(Boolean).join(' · ')}</div>
              )}
              {r.plan && r.plan.haPerTank !== null && r.plan.products.length > 0 && (
                <div><strong>{t('planPerTank', { l: r.plan.tankL ?? 0 })}:</strong> {r.plan.products.map((p) => `${p.name} ${fmtAmount(p.perFullTank ?? 0, p.unit, lang)}`).join(', ')}</div>
              )}
              <div><strong>{t('operator')}:</strong> {r.operator.name || '—'}{r.operator.certificate ? ` · ${r.operator.certificate}` : ''}</div>
              {r.nozzle && <div><strong>{t('nozzle')}:</strong> {r.nozzle}</div>}
              {r.products && r.products.length > 1 && (
                <div>
                  <strong>{t('mixTitle')}:</strong>
                  <ul className="ml-4 list-disc">
                    {r.products.map((p, i) => (
                      <li key={i}>{p.name} – {p.dose} {p.doseUnit}{p.activeSubstances.length ? ` (${p.activeSubstances.map((x) => `${x.name} ${x.amount}`.trim()).join(', ')})` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
              {r.products?.length === 1 && r.products[0].activeSubstances.length > 0 && (
                <div><strong>{t('pSubstances')}:</strong> {r.products[0].activeSubstances.map((x) => `${x.name} ${x.amount}`.trim()).join(', ')}</div>
              )}
              {r.purpose && <div><strong>{t('purpose')}:</strong> {r.purpose}</div>}
              {r.batch && r.batch.fields.length > 1 && (
                <div><strong>{t('sprayedTogether')}:</strong> {r.batch.group ? `▦ ${r.batch.group} – ` : ''}{r.batch.fields.filter((n) => n !== r.field.name).join(', ')}</div>
              )}
              {r.earliestHarvest && <div><strong>{t('harvestFrom')}:</strong> {r.earliestHarvest}</div>}
              <div className={`rounded px-2 py-1 font-bold ${STATUS_BG[r.flag]}`}>{r.flagReason}</div>
              {durationMin(r) !== null && <div><strong>{t('duration')}:</strong> {durationMin(r)} min</div>}
              <div className="font-bold">{t('weatherAtStart')}</div>
              <ul className="space-y-1">
                {r.weather.map((w) => (
                  <li key={w.key}>
                    <span className="font-semibold">{w.label}: {w.value} {w.unit}</span>
                    <span className="block text-[11px] text-neutral-700">{w.source}{w.station ? ` · ${w.station}` : ''}{w.distanceKm !== null ? ` · ${w.distanceKm} km` : ''} · {fmtTime(w.time)} · {w.kind}</span>
                  </li>
                ))}
              </ul>
              {r.weatherEnd && r.weatherEnd.length > 0 && (
                <>
                  <div className="font-bold">{t('weatherAtEnd')}</div>
                  <ul className="space-y-1">
                    {r.weatherEnd.map((w) => (
                      <li key={w.key}><span className="font-semibold">{w.label}: {w.value} {w.unit}</span>
                        <span className="block text-[11px] text-neutral-700">{w.source}{w.station ? ` · ${w.station}` : ''} · {fmtTime(w.time)}</span></li>
                    ))}
                  </ul>
                </>
              )}
              {r.prechecks.length > 0 && <div>{r.prechecks.map((p) => <div key={p.id}>{p.checked ? '☑' : '☐'} {p.label}</div>)}</div>}
              {r.notes && <div><strong>{t('notes')}:</strong> {r.notes}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
