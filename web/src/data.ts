import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO, demoApi } from './demo';
import { defaultState, normalizeState, type AppState, type Lang, type LogRecord, type Snapshot } from '@spray/shared';

/** Everything cached on the phone is kept per farm, so switching farm or account never mixes data. */
let LS = keysFor(0);
function keysFor(farmId: number) {
  const p = `spray.f${farmId}.`;
  return { farmId, snap: `${p}snapshot`, state: `${p}state`, dirty: `${p}stateDirty`, logs: `${p}logs`, queue: `${p}logQueue` };
}
export function setFarmStorage(farmId: number) { LS = keysFor(farmId); }

/** On sign-out: remove every cached copy of farm data from this phone. */
export function clearLocalData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('spray.')) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
}
/** Log records saved offline and not yet sent, across all farms on this phone. */
export function unsyncedCount(): number {
  try {
    return Object.keys(localStorage).filter((k) => k.endsWith('.logQueue'))
      .reduce((n, k) => n + ((JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[]).length), 0);
  } catch { return 0; }
}

function read<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or disabled */ }
}

export class HttpError extends Error { constructor(public status: number, public code: string) { super(`HTTP ${status}`); } }

/**
 * Every call names the farm it is for (x-farm), so a request started before switching farm can never land in
 * the other farm. The server checks membership.
 */
export async function api<T>(path: string, init?: RequestInit, farmId: number = LS.farmId): Promise<T> {
  if (DEMO) return (await demoApi(path, init)) as T;
  const headers: Record<string, string> = {};
  if (init?.body) headers['content-type'] = 'application/json';
  if (farmId) headers['x-farm'] = String(farmId);
  const res = await fetch(path, { ...init, credentials: 'same-origin', headers, signal: AbortSignal.timeout(25000) });
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('spray:signed-out'));
  if (!res.ok) {
    let code = '';
    try { code = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* not JSON */ }
    throw new HttpError(res.status, code);
  }
  return (await res.json()) as T;
}
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** Weather snapshot: server cache → localStorage → screen. Offline = last saved snapshot + flag. */
export function useSnapshot() {
  const K = useRef(LS).current;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => read<Snapshot>(K.snap));
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const s = await api<Snapshot>(force ? '/api/refresh' : '/api/snapshot', force ? { method: 'POST' } : undefined, K.farmId);
      write(K.snap, s);
      setSnapshot(s);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 2 * 60_000);
    const wake = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', () => setOffline(true));
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); };
  }, [load]);

  return { snapshot, offline, busy, refresh: () => load(true) };
}

/** Settings: instant local save, then PUT to the server (which needs them for push); retried when back online. */
export function useAppState() {
  const K = useRef(LS).current;
  const [state, setState] = useState<AppState>(() => normalizeState(read(K.state) ?? defaultState()));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback(async (s: AppState) => {
    try {
      await api('/api/state', { method: 'PUT', body: JSON.stringify(s) }, K.farmId);
      localStorage.removeItem(K.dirty);
    } catch { write(K.dirty, true); }
  }, []);

  useEffect(() => {
    (async () => {
      const local = normalizeState(read(K.state));
      if (read(K.dirty)) { await push(local); return; }
      try {
        const remote = normalizeState(await api('/api/state', undefined, K.farmId));
        if (Date.parse(remote.updatedAt) > Date.parse(local.updatedAt)) { write(K.state, remote); setState(remote); }
      } catch { /* offline: keep local */ }
    })();
    const retry = () => { if (read(K.dirty)) void push(normalizeState(read(K.state))); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [push]);

  const latest = useRef(state);
  latest.current = state;

  /** Save immediately (not debounced) and wait for the server – used when the weather depends on the change. */
  const saveNow = useCallback(async (patch: Partial<AppState>): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    const next = { ...latest.current, ...patch, updatedAt: new Date().toISOString() };
    latest.current = next;
    write(K.state, next);
    setState(next);
    try {
      await api('/api/state', { method: 'PUT', body: JSON.stringify(next) }, K.farmId);
      localStorage.removeItem(K.dirty);
      return true;
    } catch { write(K.dirty, true); return false; }
  }, []);

  const update = useCallback((patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    setState((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch), updatedAt: new Date().toISOString() };
      write(K.state, next);
      write(K.dirty, true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void push(next), 600);
      return next;
    });
  }, [push]);

  return { state, update, saveNow };
}

/** Spraying log: records made without signal are queued on the phone and sent later. */
export function useLogs() {
  const K = useRef(LS).current;
  const [logs, setLogs] = useState<LogRecord[]>(() => read<LogRecord[]>(K.logs) ?? []);
  const [queue, setQueue] = useState<LogRecord[]>(() => read<LogRecord[]>(K.queue) ?? []);

  const sync = useCallback(async () => {
    let q = read<LogRecord[]>(K.queue) ?? [];
    for (const rec of [...q]) {
      try {
        await api('/api/logs', { method: 'POST', body: JSON.stringify(rec) }, K.farmId);
        q = q.filter((x) => x.id !== rec.id);
        write(K.queue, q);
      } catch { break; }
    }
    setQueue(q);
    try {
      const remote = await api<LogRecord[]>('/api/logs', undefined, K.farmId);
      write(K.logs, remote);
      setLogs(remote);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    void sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [sync]);

  const add = useCallback(async (recs: LogRecord | LogRecord[]): Promise<boolean> => {
    const list = Array.isArray(recs) ? recs : [recs];
    const q = [...(read<LogRecord[]>(K.queue) ?? []), ...list];
    write(K.queue, q);
    setQueue(q);
    await sync();
    const left = read<LogRecord[]>(K.queue) ?? [];
    return !list.some((r) => left.some((x) => x.id === r.id));
  }, [sync]);

  const pending = new Set(queue.map((q) => q.id));
  const all = [...queue.filter((q) => !logs.some((l) => l.id === q.id)), ...logs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { logs: all, pending, add };
}

/** Re-render every 30 s so "x min ago" and staleness move without new data. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    const wake = () => setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', wake); };
  }, []);
  return now;
}

// ---- push ----
function b64ToBytes(b64: string): Uint8Array {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushCurrent(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}
export async function pushEnable(lang: Lang): Promise<'ok' | 'denied' | 'error'> {
  try {
    if ((await Notification.requestPermission()) !== 'granted') return 'denied';
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api<{ key: string }>('/api/push/key');
    const sub = (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) as BufferSource }));
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), lang }) });
    return 'ok';
  } catch { return 'error'; }
}
export async function pushDisable(): Promise<void> {
  const sub = await pushCurrent();
  if (!sub) return;
  try { await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch { /* ignore */ }
  await sub.unsubscribe();
}
export async function pushTest(lang: Lang): Promise<boolean> {
  const sub = await pushCurrent();
  if (!sub) return false;
  try { return (await api<{ ok: boolean }>('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, lang }) })).ok; } catch { return false; }
}
