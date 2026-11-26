import webpush from 'web-push';
import { buildTimeline, nextGreenWindow, normalizeState, ruleContext, type Lang, type Snapshot } from '@spray/shared';
import { config } from './config';
import { db, kvGet, kvSet } from './db';

interface Vapid { publicKey: string; privateKey: string }
let vapid = kvGet<Vapid>('vapid');
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  kvSet('vapid', vapid);
}
webpush.setVapidDetails(config.vapidSubject, vapid.publicKey, vapid.privateKey);
export const vapidPublicKey = vapid.publicKey;

export function subscribe(sub: any, lang: Lang): void {
  db.prepare('INSERT INTO push_subs (endpoint, sub, lang) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET sub = excluded.sub, lang = excluded.lang')
    .run(sub.endpoint, JSON.stringify(sub), lang);
}
export function unsubscribe(endpoint: string): void {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

async function send(row: { endpoint: string; sub: string }, payload: object): Promise<boolean> {
  try {
    await webpush.sendNotification(JSON.parse(row.sub), JSON.stringify(payload), { TTL: 3600 });
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) unsubscribe(row.endpoint); // subscription gone
    return false;
  }
}

const hhmm = (iso: string) => new Intl.DateTimeFormat('lv-LV', { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

const rigaDay = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Riga' }).format(new Date(ms));

/** "Zaļais logs atveras 18:30 (līdz 21:15)"; "rīt 06:30" when it opens after midnight. */
export function windowMessage(start: string, end: string, lang: Lang, now = Date.now()) {
  const tomorrow = rigaDay(Date.parse(start)) !== rigaDay(now);
  return lang === 'lv'
    ? { title: 'Smidzināšanas logs', body: `Zaļais logs atveras ${tomorrow ? 'rīt ' : ''}${hhmm(start)} (līdz ${hhmm(end)})` }
    : { title: 'Spray window', body: `A green window opens ${tomorrow ? 'tomorrow ' : ''}at ${hhmm(start)} (until ${hhmm(end)})` };
}

/** After every fetch: if it is not green now and a ≥ 1 h green window lies ahead, tell each subscriber once per window. */
export async function notifyGreenWindow(snap: Snapshot): Promise<number> {
  const rows = db.prepare('SELECT endpoint, sub, lang, last_window FROM push_subs').all() as any[];
  if (!rows.length) return 0;
  const ctx = ruleContext(normalizeState(kvGet('state')));
  const now = Date.now();
  const w = nextGreenWindow(buildTimeline(snap, now, ctx.thresholds, ctx.product, ctx.crop), now, 60);
  if (!w) return 0;
  let sent = 0;
  for (const row of rows) {
    // Same window if its start moved by less than an hour between forecast runs.
    if (row.last_window && Math.abs(Date.parse(row.last_window) - Date.parse(w.start)) < 3600_000) continue;
    if (await send(row, { ...windowMessage(w.start, w.end, row.lang as Lang), tag: 'green-window', url: '/', lang: row.lang })) {
      db.prepare('UPDATE push_subs SET last_window = ? WHERE endpoint = ?').run(w.start, row.endpoint);
      sent++;
    }
  }
  return sent;
}

export async function sendTest(endpoint: string, lang: Lang): Promise<boolean> {
  const row = db.prepare('SELECT endpoint, sub FROM push_subs WHERE endpoint = ?').get(endpoint) as any;
  if (!row) return false;
  return send(row, lang === 'lv'
    ? { title: 'Smidzināšanas logs', body: 'Paziņojumi darbojas.', tag: 'test', url: '/' }
    : { title: 'Spray window', body: 'Notifications are working.', tag: 'test', url: '/' });
}
