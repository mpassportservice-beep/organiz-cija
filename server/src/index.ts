import fs from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { isActive, normalizeState, type AppState, type Lang, type LogRecord, type Snapshot } from '@spray/shared';
import {
  cancelInvite, currentFarmOf, deleteAccount, farmState, farmsOf, invite, members, migrateLegacy, removeMember, renameFarm,
  roleIn, saveFarmState, setRole, signIn, userById, normEmail, createFarm, type FarmRow, type User,
} from './accounts';
import {
  createSession, endAllSessions, endSession, newNonce, NONCE_COOKIE, providers, SESSION_COOKIE, sessionUser, useNonce, verifyIdToken,
} from './auth';
import { config } from './config';
import { db, logDelete, logDeleteActive, logInsert, logList } from './db';
import { logsToCsv, logsToPdf } from './export';
import { farmKey, farmLocation, type Farm } from './farm';
import { farmsWithSubscribers, notifyGreenWindow, sendTest, subscribe, unsubscribe, vapidPublicKey } from './push';
import { cachedSnapshot, msSinceLastRun, refreshAll } from './weather';

declare module 'fastify' {
  interface FastifyRequest { user?: User; farm?: FarmRow }
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 2 * 1024 * 1024, trustProxy: config.trustProxy });
await app.register(fastifyCookie);
const log = (m: string) => app.log.warn(m);
const langOf = (q: any): Lang => (q?.lang === 'en' ? 'en' : 'lv');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

migrateLegacy();

// ---------- security basics ----------
/** State-changing API calls must come from this site (cookies are SameSite=Lax as a second line). */
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'GET' || req.method === 'HEAD' || !req.url.startsWith('/api/')) return;
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.host; } catch { /* malformed */ }
    if (!ok) return reply.code(403).send({ error: 'Bad origin' });
  }
});
app.addHook('onSend', async (req, reply) => {
  if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
});

function setSession(req: FastifyRequest, reply: FastifyReply, userId: number) {
  const { token, maxAge } = createSession(userId);
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https', maxAge });
}

async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const uid = sessionUser(req.cookies[SESSION_COOKIE]);
  const user = uid ? userById(uid) : null;
  if (!user) return reply.code(401).send({ error: 'Not signed in' });
  // The phone says which farm a request is for; it must be one the user belongs to.
  const asked = Number(req.headers['x-farm']);
  let farm: FarmRow | null = null;
  if (asked) {
    const role = roleIn(user.id, asked);
    if (!role) return reply.code(403).send({ error: 'notMember' });
    farm = farmsOf(user.id).find((f) => f.id === asked) ?? null;
    db.prepare('UPDATE farms SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), asked);
  } else farm = currentFarmOf(user);
  if (!farm) return reply.code(401).send({ error: 'Not signed in' });
  req.user = user;
  req.farm = farm;
}
async function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (req.farm!.role !== 'owner') return reply.code(403).send({ error: 'Only the farm owner can do this' });
}
const signedIn = { preHandler: requireUser };
const owner = { preHandler: requireOwner };

// ---------- weather ----------
const locationOf = (farmId: number): Farm => farmLocation(farmState(farmId));

/** Fetch one location, then notify every subscribed farm that sits at it. */
async function cycleFor(loc: Farm, farmIds: number[]): Promise<Snapshot> {
  const snap = await refreshAll(loc, log);
  for (const id of farmIds) {
    try { await notifyGreenWindow(id, snap); } catch (e: any) { log(`[push] farm ${id}: ${e?.message ?? e}`); }
  }
  return snap;
}

/** Every few minutes: locations of farms used in the last 7 days or with phones subscribed to notifications. */
async function backgroundCycle() {
  const recent = (db.prepare('SELECT id FROM farms WHERE last_seen >= ?').all(new Date(Date.now() - 7 * 86_400_000).toISOString()) as { id: number }[]).map((r) => r.id);
  const subscribed = farmsWithSubscribers();
  const byKey = new Map<string, { loc: Farm; subs: number[] }>();
  for (const id of new Set([...recent, ...subscribed])) {
    const loc = locationOf(id);
    const e = byKey.get(farmKey(loc)) ?? { loc, subs: [] };
    if (subscribed.includes(id)) e.subs.push(id);
    byKey.set(farmKey(loc), e);
  }
  if (!byKey.size) byKey.set(farmKey(config.farm), { loc: config.farm, subs: [] });
  for (const { loc, subs } of byKey.values()) await cycleFor(loc, subs); // one place at a time: gentle on the APIs
}

const farmsAt = (loc: Farm) => farmsWithSubscribers().filter((id) => farmKey(locationOf(id)) === farmKey(loc));

app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));
app.get('/api/snapshot', signedIn, async (req) => {
  const loc = locationOf(req.farm!.id);
  return cachedSnapshot(loc) ?? cycleFor(loc, farmsAt(loc));
});
/** Manual refresh. Upstream is hit at most once a minute per place no matter how often the button is pressed. */
app.post('/api/refresh', signedIn, async (req) => {
  const loc = locationOf(req.farm!.id);
  const cached = cachedSnapshot(loc);
  return cached && msSinceLastRun(loc) < 60_000 ? cached : cycleFor(loc, farmsAt(loc));
});

// ---------- sign-in ----------
app.get('/api/auth/config', async () => {
  const p = providers();
  return { google: p.google?.audience ?? null, apple: p.apple?.audience ?? null, dev: config.auth.devLogin };
});
/** One-time value the provider puts into the ID token; also kept in an HttpOnly cookie to bind it to this browser. */
app.get('/api/auth/nonce', async (req, reply) => {
  const nonce = newNonce();
  reply.setCookie(NONCE_COOKIE, nonce, { path: '/api/auth', httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https', maxAge: 600 });
  return { nonce };
});

async function finishSignIn(req: FastifyRequest, reply: FastifyReply, provider: 'google' | 'apple', token: unknown, extraName = '') {
  const p = providers()[provider];
  if (!p) return reply.code(404).send({ error: `${provider} sign-in is not configured` });
  if (typeof token !== 'string' || token.length > 8192) return reply.code(400).send({ error: 'No token' });
  const nonce = req.cookies[NONCE_COOKIE];
  reply.clearCookie(NONCE_COOKIE, { path: '/api/auth' });
  if (!useNonce(nonce)) return reply.code(401).send({ error: 'Sign-in expired, try again' });
  try {
    const id = await verifyIdToken(p, token, nonce!);
    const user = signIn(id.provider, id.subject, id.email, id.name || extraName);
    setSession(req, reply, user.id);
    return { ok: true };
  } catch (e: any) {
    req.log.warn(`[auth] ${provider} token rejected: ${e?.message ?? e}`);
    return reply.code(401).send({ error: 'Sign-in could not be verified' });
  }
}
app.post('/api/auth/google', async (req, reply) => finishSignIn(req, reply, 'google', (req.body as any)?.credential));
app.post('/api/auth/apple', async (req, reply) => {
  const b = req.body as any;
  // Apple sends the name only on the very first sign-in, outside the token.
  const n = b?.user?.name ? `${b.user.name.firstName ?? ''} ${b.user.name.lastName ?? ''}`.trim() : '';
  return finishSignIn(req, reply, 'apple', b?.id_token, n);
});
if (config.auth.devLogin) {
  app.log.warn('DEV_LOGIN is on: anyone can sign in as any e-mail. Never use this on a public server.');
  app.post('/api/auth/dev', async (req, reply) => {
    const email = String((req.body as any)?.email ?? '');
    if (!EMAIL.test(email)) return reply.code(400).send({ error: 'E-mail' });
    const user = signIn('dev', normEmail(email), email, String((req.body as any)?.name ?? ''));
    setSession(req, reply, user.id);
    return { ok: true };
  });
}
app.post('/api/auth/logout', async (req, reply) => {
  endSession(req.cookies[SESSION_COOKIE]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
});

// ---------- account & farm ----------
function meOf(user: User, farm: FarmRow) {
  const fresh = userById(user.id)!;
  return {
    user: { id: fresh.id, email: fresh.email, name: fresh.name },
    farm: { id: farm.id, name: farm.name, role: farm.role },
    farms: farmsOf(user.id),
    ...members(farm.id),
  };
}
app.get('/api/me', signedIn, async (req) => meOf(req.user!, req.farm!));
app.post('/api/farm/switch', signedIn, async (req, reply) => {
  const id = Number((req.body as any)?.farmId);
  if (!roleIn(req.user!.id, id)) return reply.code(404).send({ error: 'No such farm' });
  db.prepare('UPDATE users SET current_farm_id = ? WHERE id = ?').run(id, req.user!.id);
  return meOf(userById(req.user!.id)!, currentFarmOf(userById(req.user!.id)!)!);
});
app.post('/api/farm/new', signedIn, async (req) => {
  const id = createFarm(req.user!.id, String((req.body as any)?.name ?? '').trim().slice(0, 80) || 'Jauna saimniecība');
  db.prepare('UPDATE users SET current_farm_id = ? WHERE id = ?').run(id, req.user!.id);
  return meOf(userById(req.user!.id)!, currentFarmOf(userById(req.user!.id)!)!);
});
app.put('/api/farm', owner, async (req) => {
  renameFarm(req.farm!.id, String((req.body as any)?.name ?? ''));
  return meOf(req.user!, currentFarmOf(req.user!)!);
});
app.post('/api/farm/invite', owner, async (req, reply) => {
  const email = String((req.body as any)?.email ?? '').trim();
  if (!EMAIL.test(email) || email.length > 200) return reply.code(400).send({ error: 'E-mail' });
  const result = invite(req.farm!.id, email, req.user!.id);
  return { result, ...meOf(req.user!, req.farm!) };
});
app.post('/api/farm/invite/cancel', owner, async (req) => {
  cancelInvite(req.farm!.id, String((req.body as any)?.email ?? ''));
  return meOf(req.user!, req.farm!);
});
app.post('/api/farm/member/remove', owner, async (req, reply) => {
  const uid = Number((req.body as any)?.userId);
  if (uid === req.user!.id) return reply.code(400).send({ error: 'Use leave' });
  removeMember(req.farm!.id, uid);
  return meOf(req.user!, req.farm!);
});
app.post('/api/farm/member/role', owner, async (req, reply) => {
  const b = req.body as any;
  const role = b?.role === 'owner' ? 'owner' : 'member';
  if (!roleIn(Number(b?.userId), req.farm!.id)) return reply.code(404).send({ error: 'No such member' });
  if (setRole(req.farm!.id, Number(b.userId), role) === 'lastOwner') return reply.code(409).send({ error: 'lastOwner' });
  return meOf(req.user!, currentFarmOf(req.user!)!);
});
app.post('/api/farm/leave', signedIn, async (req, reply) => {
  if (farmsOf(req.user!.id).length <= 1) return reply.code(409).send({ error: 'onlyFarm' });
  if (removeMember(req.farm!.id, req.user!.id) === 'lastOwner') return reply.code(409).send({ error: 'lastOwner' });
  const u = userById(req.user!.id)!;
  return meOf(u, currentFarmOf(u)!);
});
app.post('/api/account/delete', signedIn, async (req, reply) => {
  const uid = req.user!.id;
  endAllSessions(uid);
  deleteAccount(uid);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return { ok: true };
});

// ---------- farm data ----------
app.get('/api/state', signedIn, async (req) => farmState(req.farm!.id));
app.put('/api/state', signedIn, async (req) => {
  const s: AppState = { ...normalizeState(req.body), updatedAt: new Date().toISOString() };
  const before = farmKey(locationOf(req.farm!.id));
  saveFarmState(req.farm!.id, s);
  const loc = locationOf(req.farm!.id);
  if (farmKey(loc) !== before && !cachedSnapshot(loc)) void cycleFor(loc, farmsAt(loc)); // new place: fetch it right away
  return s;
});

app.get('/api/logs', signedIn, async (req) => logList(req.farm!.id));
app.post('/api/logs', signedIn, async (req, reply) => {
  const r = req.body as LogRecord;
  if (!r || typeof r.id !== 'string' || !r.id || r.id.length > 100 || Number.isNaN(Date.parse(r.startedAt)) || !r.field || !r.product || !r.crop || !Array.isArray(r.weather)) {
    return reply.code(400).send({ error: 'Invalid log record' });
  }
  const rec: LogRecord = { ...r, recordedBy: { name: req.user!.name, email: req.user!.email } };
  if (!logInsert(req.farm!.id, rec)) return reply.code(409).send({ error: 'Record id in use' });
  return { ok: true, id: r.id };
});
app.delete('/api/logs/:id', signedIn, async (req, reply) => {
  if (!logDeleteActive(req.farm!.id, String((req.params as { id: string }).id))) return reply.code(409).send({ error: 'Only a running spraying can be cancelled' });
  return { ok: true };
});
/** Settings → delete log records (of this farm only). */
app.post('/api/logs/delete', signedIn, async (req, reply) => {
  const ids = (req.body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || ids.length > 5000 || !ids.every((x) => typeof x === 'string')) return reply.code(400).send({ error: 'ids' });
  return { ok: true, deleted: logDelete(req.farm!.id, ids as string[]) };
});
app.get('/api/logs.csv', signedIn, async (req, reply) => {
  reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="aal-uzskaite.csv"');
  return logsToCsv(logList(req.farm!.id).filter((r) => !isActive(r)), langOf(req.query));
});
app.get('/api/logs.pdf', signedIn, async (req, reply) => {
  reply.header('content-type', 'application/pdf').header('content-disposition', 'attachment; filename="aal-uzskaite.pdf"');
  return logsToPdf(logList(req.farm!.id).filter((r) => !isActive(r)), langOf(req.query), req.farm!.name);
});

app.get('/api/push/key', async () => ({ key: vapidPublicKey }));
app.post('/api/push/subscribe', signedIn, async (req, reply) => {
  const b = req.body as any;
  if (!b?.subscription?.endpoint || typeof b.subscription.endpoint !== 'string' || !/^https:\/\//.test(b.subscription.endpoint)) {
    return reply.code(400).send({ error: 'No subscription' });
  }
  subscribe(req.farm!.id, b.subscription, langOf(b));
  return { ok: true };
});
app.post('/api/push/unsubscribe', signedIn, async (req) => { unsubscribe(String((req.body as any)?.endpoint ?? ''), req.farm!.id); return { ok: true }; });
app.post('/api/push/test', signedIn, async (req) => ({ ok: await sendTest(req.farm!.id, String((req.body as any)?.endpoint ?? ''), langOf(req.body)) }));

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
void backgroundCycle();
setInterval(() => void backgroundCycle(), config.fetchIntervalMin * 60_000);
