import { useState } from 'react';
import type { Ctx } from '../App';
import { DEMO } from '../demo';
import { Btn, fmtDate, fmtTime, STATUS_BG } from '../ui';

export function Log({ ctx }: { ctx: Ctx }) {
  const { t, lang, logs, pendingLogs } = ctx;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3 px-3 pb-6">
      <h1 className="text-2xl font-black">{t('logTitle')}</h1>
      {DEMO && <p className="rounded-lg bg-neutral-200 px-3 py-2 text-sm font-semibold">{lang === 'lv' ? 'Priekšskatījumā CSV/PDF eksports nav pieejams – tas darbojas īstajā lietotnē.' : 'CSV/PDF export is not available in this preview – it works in the real app.'}</p>}
      <div className={`grid grid-cols-2 gap-2 ${DEMO ? 'hidden' : ''}`}>
        <a className="flex min-h-12 items-center justify-center rounded-lg border-2 border-neutral-900 font-bold" href={`/api/logs.csv?lang=${lang}`} download>{t('exportCsv')}</a>
        <a className="flex min-h-12 items-center justify-center rounded-lg border-2 border-neutral-900 font-bold" href={`/api/logs.pdf?lang=${lang}`} download>{t('exportPdf')}</a>
      </div>
      {logs.length === 0 && <p className="font-semibold">{t('logEmpty')}</p>}
      {logs.map((r) => (
        <div key={r.id} className="rounded-xl border-2 border-neutral-900">
          <button className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
            <span className={`mt-1 rounded px-1.5 py-0.5 text-xs font-black uppercase ${STATUS_BG[r.flag]}`}>{r.flag === 'green' ? '✓' : r.flag === 'amber' ? '!' : '✕'}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">{fmtDate(r.startedAt)} {fmtTime(r.startedAt)} · {r.field.name}</span>
              <span className="block text-sm font-semibold">{r.product.name} · {r.dose} {r.doseUnit}{r.crop.name ? ` · ${r.crop.name}` : ''}{r.crop.bbch !== null ? ` BBCH ${r.crop.bbch}` : ''}</span>
              {pendingLogs.has(r.id) && <span className="mt-1 inline-block rounded bg-neutral-900 px-1.5 text-xs font-bold text-white">{t('notSynced')}</span>}
            </span>
            <span className="text-xl" aria-hidden>{open === r.id ? '▴' : '▾'}</span>
          </button>
          {open === r.id && (
            <div className="space-y-2 border-t-2 border-neutral-900 p-3 text-sm">
              {r.recordedBy && <div><strong>{t('recordedBy')}:</strong> {r.recordedBy.name || r.recordedBy.email}</div>}
              <div><strong>{t('operator')}:</strong> {r.operator.name || '—'}{r.operator.certificate ? ` · ${r.operator.certificate}` : ''}</div>
              {r.nozzle && <div><strong>{t('nozzle')}:</strong> {r.nozzle}</div>}
              {r.purpose && <div><strong>{t('purpose')}:</strong> {r.purpose}</div>}
              {r.batch && r.batch.fields.length > 1 && (
                <div><strong>{t('sprayedTogether')}:</strong> {r.batch.group ? `▦ ${r.batch.group} – ` : ''}{r.batch.fields.filter((n) => n !== r.field.name).join(', ')}</div>
              )}
              {r.earliestHarvest && <div><strong>{t('harvestFrom')}:</strong> {r.earliestHarvest}</div>}
              <div className={`rounded px-2 py-1 font-bold ${STATUS_BG[r.flag]}`}>{r.flagReason}</div>
              <div className="font-bold">{t('weatherAtStart')}</div>
              <ul className="space-y-1">
                {r.weather.map((w) => (
                  <li key={w.key}>
                    <span className="font-semibold">{w.label}: {w.value} {w.unit}</span>
                    <span className="block text-[11px] text-neutral-700">{w.source}{w.station ? ` · ${w.station}` : ''}{w.distanceKm !== null ? ` · ${w.distanceKm} km` : ''} · {fmtTime(w.time)} · {w.kind}</span>
                  </li>
                ))}
              </ul>
              <div>{r.prechecks.map((p) => <div key={p.id}>{p.checked ? '☑' : '☐'} {p.label}</div>)}</div>
              {r.notes && <div><strong>{t('notes')}:</strong> {r.notes}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
