import { useEffect, useMemo, useState } from 'react';
import {
  bestWindow, buildTimeline, conditionsNow, evaluate, ruleContext,
  type AppState, type Conditions, type FarmLocation, type Evaluation, type Lang, type LogRecord, type Snapshot, type TimelineSlot, type Window,
} from '@spray/shared';
import { useAppState, useLogs, useNow, useSnapshot } from './data';
import { DEMO, getScenario, RECORDED_AT, setScenario, type Scenario } from './demo';
import { makeT, type TFn } from './i18n';
import { fmtDate, fmtTime } from './ui';
import { Log } from './screens/Log';
import { Main } from './screens/Main';
import { Precheck } from './screens/Precheck';
import { Products } from './screens/Products';
import { Settings } from './screens/Settings';
import { LocationPicker } from './screens/Location';

export interface Ctx {
  lang: Lang; t: TFn; now: number;
  state: AppState; update: ReturnType<typeof useAppState>['update'];
  snapshot: Snapshot | null; offline: boolean; busy: boolean; refresh: () => void; locPending: boolean;
  rule: ReturnType<typeof ruleContext>;
  conditions: Conditions | null; evaluation: Evaluation | null; timeline: TimelineSlot[]; best: Window | null;
  logs: LogRecord[]; pendingLogs: Set<string>; addLog: (r: LogRecord | LogRecord[]) => Promise<boolean>; removeLogs: (ids: string[]) => Promise<boolean>; purgeLogs: (ids: string[]) => Promise<boolean>;
  openLog: () => void;
}

type Tab = 'now' | 'products' | 'log' | 'settings' | 'precheck';

export function App() {
  const { state, update, saveNow } = useAppState();
  const [locOpen, setLocOpen] = useState(false);
  const { snapshot, offline, busy, refresh } = useSnapshot();
  const { logs, pending, add, remove, purge } = useLogs();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('now');
  const [toast, setToast] = useState('');
  const [scen, setScen] = useState<Scenario>(getScenario());
  const lang = state.lang;
  const t = useMemo(() => makeT(lang), [lang]);
  const baseRule = useMemo(() => ruleContext(state), [state]);

  useEffect(() => { document.documentElement.lang = lang; document.title = t('appName'); }, [lang, t]);
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id); }, [toast]);

  const derived = useMemo(() => {
    let rule = baseRule;
    if (!snapshot) return { rule, conditions: null, evaluation: null, timeline: [], best: null };
    const conditions = conditionsNow(snapshot, now, rule.thresholds, rule.product);
    // A group is as strict as its strictest field: use the field whose crop stage fares worst against the product.
    if (rule.targetFields.length > 1 && rule.product) {
      const RANK = { info: 0, green: 1, amber: 2, red: 3 } as const;
      let worst = -1;
      for (const f of rule.targetFields) {
        const crop = { cropId: f.cropId, bbch: f.bbch };
        const st = evaluate(conditions, rule.thresholds, rule.product, crop).checks.find((c) => c.id === 'crop')?.status ?? 'info';
        if (RANK[st] > worst) { worst = RANK[st]; rule = { ...rule, field: f, crop }; }
      }
    }
    const timeline = buildTimeline(snapshot, now, rule.thresholds, rule.product, rule.crop);
    return { rule, conditions, evaluation: evaluate(conditions, rule.thresholds, rule.product, rule.crop), timeline, best: bestWindow(timeline) };
  }, [snapshot, now, baseRule]);

  const placeName = state.location
    ? state.location.name || `${state.location.lat.toFixed(3)}, ${state.location.lon.toFixed(3)}`
    : snapshot?.farm.name ?? 'Priekuļi';
  // The server answers for the new place within seconds; until then the old place's data must not be used.
  const locPending = !!snapshot && !!state.location && (Math.abs(snapshot.farm.lat - state.location.lat) > 1e-4 || Math.abs(snapshot.farm.lon - state.location.lon) > 1e-4);
  const saveLocation = async (loc: FarmLocation | null) => {
    setLocOpen(false);
    await saveNow({ location: loc });
    refresh();
  };

  const ctx: Ctx = { lang, t, now, state, update, snapshot: locPending ? null : snapshot, offline, busy: busy || locPending, refresh, locPending, ...derived, logs, pendingLogs: pending, addLog: add, removeLogs: remove, purgeLogs: purge, openLog: () => setTab('log') };
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'now', label: t('tabNow'), icon: '◉' }, { id: 'products', label: t('tabProducts'), icon: '⚗' },
    { id: 'log', label: t('tabLog'), icon: '📚' }, { id: 'settings', label: t('tabSettings'), icon: '⚙' },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="safe-t flex items-center justify-between px-3 py-2">
        <div className="flex min-w-0 items-center gap-1 text-base font-black tracking-tight">
          <span className="shrink-0">{t('appName')}</span>
          <button onClick={() => setLocOpen(true)} aria-label={`${t('locTitle')}: ${placeName}`}
            className="flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-1.5 font-bold text-neutral-800 underline decoration-dotted underline-offset-4">
            <svg width="16" height="21" viewBox="0 0 36 48" className="shrink-0" aria-hidden><path d="M18 1C8.6 1 1 8.4 1 17.6 1 30 18 47 18 47s17-17 17-29.4C35 8.4 27.4 1 18 1z" fill="#b91c1c" stroke="#0a0a0a" strokeWidth="3"/><circle cx="18" cy="17.5" r="6.5" fill="#fff"/></svg>
            <span className="truncate">{placeName}</span>
          </button>
        </div>
        <button className="min-h-11 min-w-14 rounded-lg border-2 border-neutral-900 px-2 text-sm font-black" onClick={() => update({ lang: lang === 'lv' ? 'en' : 'lv' })}
          aria-label={lang === 'lv' ? 'Switch to English' : 'Pārslēgt uz latviešu valodu'}>
          {lang === 'lv' ? 'EN' : 'LV'}
        </button>
      </header>
      {DEMO && (
        <div className="mx-3 mb-2 rounded-lg border-2 border-dashed border-neutral-900 bg-neutral-100 p-2 text-xs font-semibold">
          <div><span className="rounded bg-neutral-900 px-1 font-black text-white">DEMO</span>{' '}
            {scen === 'sample'
              ? (lang === 'lv' ? 'Izdomāti parauga dati (labs rīts), nevis īsti laikapstākļi.' : 'Invented sample data (a good morning), not real weather.')
              : (lang === 'lv' ? `Īsti dati, ierakstīti ${fmtDate(RECORDED_AT)} ${fmtTime(RECORDED_AT)}; laiki pārbīdīti uz tagadni.` : `Real data recorded ${fmtDate(RECORDED_AT)} ${fmtTime(RECORDED_AT)}; times moved to now.`)}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {(['sample', 'recorded'] as const).map((s) => (
              <button key={s} aria-pressed={scen === s} onClick={() => { setScenario(s); setScen(s); refresh(); }}
                className={`min-h-9 rounded-md border-2 border-neutral-900 font-bold ${scen === s ? 'bg-neutral-950 text-white' : 'bg-white'}`}>
                {s === 'sample' ? (lang === 'lv' ? 'Paraugs: labs rīts' : 'Sample: good morning') : (lang === 'lv' ? 'Ieraksts: 16. nov. vakars' : 'Recorded: 16 Nov evening')}
              </button>
            ))}
          </div>
        </div>
      )}
      <main className="flex-1">
        {tab === 'now' && <Main ctx={ctx} onStart={() => setTab('precheck')} />}
        {tab === 'precheck' && <Precheck ctx={ctx} onCancel={() => setTab('now')} onDone={(synced) => { setToast(synced ? t('sprayStarted') : t('sprayStartedOffline')); setTab('log'); }} />}
        {tab === 'products' && <Products ctx={ctx} />}
        {tab === 'log' && <Log ctx={ctx} />}
        {tab === 'settings' && <Settings ctx={ctx} />}
      </main>
      {locOpen && <LocationPicker ctx={ctx} onClose={() => setLocOpen(false)} onSave={(l) => void saveLocation(l)} />}
      {toast && <div className="fixed inset-x-3 bottom-24 z-40 mx-auto max-w-md rounded-xl bg-neutral-950 px-4 py-3 text-center font-bold text-white" role="status">{toast}</div>}
      <nav className="safe-b sticky bottom-0 z-20 grid grid-cols-4 border-t-2 border-neutral-900 bg-white">
        {tabs.map((x) => {
          const active = tab === x.id || (x.id === 'now' && tab === 'precheck');
          return (
            <button key={x.id} onClick={() => setTab(x.id)} aria-current={active ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center text-xs font-bold ${active ? 'bg-neutral-950 text-white' : ''}`}>
              <span className="text-lg leading-none" aria-hidden>{x.icon}</span>{x.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
