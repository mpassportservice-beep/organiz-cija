import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { isActive, normalizeState, type AppState, type Lang, type LogRecord } from '@spray/shared';
import { config } from './config';
import { kvGet, kvSet, logDeleteActive, logInsert, logList } from './db';
import { logsToCsv, logsToPdf } from './export';
import { notifyGreenWindow, sendTest, subscribe, unsubscribe, vapidPublicKey } from './push';
import { currentSnapshot, locationChanged, msSinceLastRun, refreshAll } from './weather';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 2 * 1024 * 1024 });
const log = (m: string) => app.log.warn(m);
const langOf = (q: any): Lang => (q?.lang === 'en' ? 'en' : 'lv');

async function cycle() {
  const snap = await refreshAll(log);
  try { await notifyGreenWindow(snap); } catch (e: any) { app.log.warn(`[push] ${e?.message ?? e}`); }
  return snap;
}

app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));
app.get('/api/snapshot', async (_req, reply) => { reply.header('cache-control', 'no-store'); return currentSnapshot(); });
/** Manual refresh. Upstream is hit at most once a minute no matter how often the button is pressed. */
app.post('/api/refresh', async () => (msSinceLastRun() < 60_000 && !locationChanged() ? currentSnapshot() : cycle()));

app.get('/api/state', async () => normalizeState(kvGet('state')));
app.put('/api/state', async (req) => {
  const s: AppState = { ...normalizeState(req.body), updatedAt: new Date().toISOString() };
  kvSet('state', s);
  if (locationChanged()) void cycle(); // new place: fetch its weather right away
  return s;
});

app.get('/api/logs', async () => logList());
app.post('/api/logs', async (req, reply) => {
  const r = req.body as LogRecord;
  if (!r || typeof r.id !== 'string' || !r.id || Number.isNaN(Date.parse(r.startedAt)) || !r.field || !r.product || !r.crop || !Array.isArray(r.weather)) {
    return reply.code(400).send({ error: 'Invalid log record' });
  }
  logInsert(r);
  return { ok: true, id: r.id };
});
app.delete('/api/logs/:id', async (req, reply) => {
  if (!logDeleteActive(String((req.params as { id: string }).id))) return reply.code(409).send({ error: 'Only a running spraying can be cancelled' });
  return { ok: true };
});
app.get('/api/logs.csv', async (req, reply) => {
  reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="aal-uzskaite.csv"');
  return logsToCsv(logList().filter((r) => !isActive(r)), langOf(req.query));
});
app.get('/api/logs.pdf', async (req, reply) => {
  reply.header('content-type', 'application/pdf').header('content-disposition', 'attachment; filename="aal-uzskaite.pdf"');
  return logsToPdf(logList().filter((r) => !isActive(r)), langOf(req.query));
});

app.get('/api/push/key', async () => ({ key: vapidPublicKey }));
app.post('/api/push/subscribe', async (req, reply) => {
  const b = req.body as any;
  if (!b?.subscription?.endpoint) return reply.code(400).send({ error: 'No subscription' });
  subscribe(b.subscription, langOf(b));
  return { ok: true };
});
app.post('/api/push/unsubscribe', async (req) => { unsubscribe(String((req.body as any)?.endpoint ?? '')); return { ok: true }; });
app.post('/api/push/test', async (req) => ({ ok: await sendTest(String((req.body as any)?.endpoint ?? ''), langOf(req.body)) }));

if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    setHeaders(res, p) {
      if (p.includes('/assets/')) res.header('cache-control', 'public, max-age=31536000, immutable');
      else res.header('cache-control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
} else {
  app.log.warn('web/dist not found – run "npm run build" (API only for now)');
}

await app.listen({ port: config.port, host: config.host });
void cycle();
setInterval(() => void cycle(), config.fetchIntervalMin * 60_000);
