import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import crypto from 'node:crypto';
import { defaultState } from '@spray/shared';
import {
  deleteAccount, farmState, farmsOf, invite, members, migrateLegacy, removeMember, roleIn, saveFarmState, signIn, userById, currentFarmOf,
} from '../src/accounts';
import { createSession, endSession, newNonce, sessionUser, useNonce, verifyIdToken, type Provider } from '../src/auth';
import { config } from '../src/config';
import { db, kvSet, logInsert, logList } from '../src/db';

function wipe() {
  for (const t of ['sessions', 'identities', 'memberships', 'invites', 'users', 'farms', 'logs', 'push_subs', 'auth_nonces']) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM kv WHERE key IN ('state', 'legacyFarm')");
  config.ownerEmail = '';
}

describe('ID token verification', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const google: Provider = { id: 'google', issuers: ['https://accounts.google.com', 'accounts.google.com'], audience: 'client-123', keys: createLocalJWKSet({ keys: [jwk] }) };
  const sign = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string; key?: KeyLike } = {}) =>
    new SignJWT({ email: 'Anna@Example.lv', email_verified: true, nonce: 'n1', name: 'Anna', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(o.iss ?? 'https://accounts.google.com').setAudience(o.aud ?? 'client-123')
      .setSubject('sub-1').setIssuedAt().setExpirationTime(o.exp ?? '10m').sign(o.key ?? privateKey);

  it('accepts a correctly signed token and returns subject and e-mail', async () => {
    expect(await verifyIdToken(google, await sign({}), 'n1')).toEqual({ provider: 'google', subject: 'sub-1', email: 'Anna@Example.lv', name: 'Anna' });
  });
  it('accepts a SHA-256 hashed nonce (Apple)', async () => {
    const h = crypto.createHash('sha256').update('raw').digest('hex');
    await expect(verifyIdToken(google, await sign({ nonce: h }), 'raw')).resolves.toBeTruthy();
  });
  it.each([
    ['wrong audience', () => sign({}, { aud: 'someone-else' }), 'n1'],
    ['wrong issuer', () => sign({}, { iss: 'https://evil.example' }), 'n1'],
    ['expired', () => sign({}, { exp: '-5m' }), 'n1'],
    ['wrong nonce', () => sign({}), 'other'],
    ['no nonce expected', () => sign({}), null],
    ['unverified e-mail', () => sign({ email_verified: false }), 'n1'],
    ['no e-mail', () => sign({ email: undefined }), 'n1'],
  ] as const)('rejects: %s', async (_n, make, nonce) => {
    await expect(verifyIdToken(google, await make(), nonce)).rejects.toThrow();
  });
  it('rejects a token signed with another key', async () => {
    const other = await generateKeyPair('RS256');
    await expect(verifyIdToken(google, await sign({}, { key: other.privateKey }), 'n1')).rejects.toThrow();
  });
  it('rejects a tampered token', async () => {
    const t = await sign({});
    const [h, p, s] = t.split('.');
    const body = JSON.parse(Buffer.from(p, 'base64url').toString());
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...body, email: 'boss@example.lv' })).toString('base64url')}.${s}`;
    await expect(verifyIdToken(google, forged, 'n1')).rejects.toThrow();
  });
});

describe('nonces and sessions', () => {
  beforeEach(wipe);
  it('a nonce works once', () => {
    const n = newNonce();
    expect(useNonce(n)).toBe(true);
    expect(useNonce(n)).toBe(false);
    expect(useNonce('made-up')).toBe(false);
  });
  it('session token maps to the user until it is ended', () => {
    const u = signIn('google', 's', 'a@x.lv', '');
    const { token } = createSession(u.id);
    expect(sessionUser(token)).toBe(u.id);
    expect(sessionUser(token + 'x')).toBeNull();
    endSession(token);
    expect(sessionUser(token)).toBeNull();
    // only a hash is stored
    expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain(token);
  });
});

describe('accounts and farms', () => {
  beforeEach(wipe);

  it('a new account gets its own farm with default settings', () => {
    const u = signIn('google', 'g1', 'Anna@X.lv', 'Anna');
    expect(u.email).toBe('anna@x.lv');
    const farms = farmsOf(u.id);
    expect(farms).toHaveLength(1);
    expect(farms[0].role).toBe('owner');
    expect(farmState(farms[0].id).fields).toHaveLength(1);
  });

  it('Google and Apple with the same e-mail are one account', () => {
    const a = signIn('google', 'g1', 'anna@x.lv', '');
    const b = signIn('apple', 'a1', 'ANNA@x.lv', '');
    expect(b.id).toBe(a.id);
    expect(farmsOf(a.id)).toHaveLength(1);
  });

  it('two people never see each other\'s farm', () => {
    const a = signIn('google', 'g1', 'a@x.lv', '');
    const b = signIn('google', 'g2', 'b@x.lv', '');
    const fa = currentFarmOf(a)!.id, fb = currentFarmOf(b)!.id;
    expect(fa).not.toBe(fb);
    expect(roleIn(b.id, fa)).toBeNull();
    logInsert(fa, { id: 'r1', startedAt: '2026-05-01T06:00:00Z' } as any);
    expect(logList(fb)).toEqual([]);
    // b cannot overwrite a's record by reusing its id
    expect(logInsert(fb, { id: 'r1', startedAt: '2026-05-01T06:00:00Z' } as any)).toBe(false);
    expect(logList(fa)).toHaveLength(1);
  });

  it('an invited e-mail joins the farm on first sign-in and starts there', () => {
    const owner = signIn('google', 'g1', 'owner@x.lv', '');
    const farm = currentFarmOf(owner)!.id;
    expect(invite(farm, 'Driver@X.lv', owner.id)).toBe('invited');
    expect(members(farm).invites.map((i) => i.email)).toEqual(['driver@x.lv']);
    const driver = signIn('apple', 'a9', 'driver@x.lv', '');
    expect(roleIn(driver.id, farm)).toBe('member');
    expect(currentFarmOf(userById(driver.id)!)!.id).toBe(farm);
    expect(members(farm).invites).toEqual([]);
  });

  it('inviting an existing account adds it at once', () => {
    const owner = signIn('google', 'g1', 'owner@x.lv', '');
    const other = signIn('google', 'g2', 'other@x.lv', '');
    expect(invite(currentFarmOf(owner)!.id, 'other@x.lv', owner.id)).toBe('added');
    expect(farmsOf(other.id)).toHaveLength(2);
  });

  it('the last owner cannot leave while others remain; deleting the account hands the farm on', () => {
    const owner = signIn('google', 'g1', 'owner@x.lv', '');
    const farm = currentFarmOf(owner)!.id;
    const m = signIn('google', 'g2', 'm@x.lv', '');
    invite(farm, 'm@x.lv', owner.id);
    expect(removeMember(farm, owner.id)).toBe('lastOwner');
    deleteAccount(owner.id);
    expect(userById(owner.id)).toBeNull();
    expect(roleIn(m.id, farm)).toBe('owner');
  });

  it('deleting the only member deletes the farm and its log', () => {
    const u = signIn('google', 'g1', 'solo@x.lv', '');
    const farm = currentFarmOf(u)!.id;
    logInsert(farm, { id: 'r1', startedAt: '2026-05-01T06:00:00Z' } as any);
    deleteAccount(u.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM farms WHERE id = ?').get(farm)).toEqual({ n: 0 });
    expect(logList(farm)).toEqual([]);
  });

  it('data from before sign-in goes to OWNER_EMAIL only', () => {
    const st = { ...defaultState(), fields: [{ id: 'x', name: 'Vecais lauks', areaHa: 2, cropId: null, bbch: null, water: [], neighbours: [], hives: [] }] };
    kvSet('state', st);
    db.prepare("INSERT INTO logs (id, started_at, record) VALUES ('old', '2026-04-01T06:00:00Z', '{\"id\":\"old\"}')").run();
    config.ownerEmail = 'Boss@Farm.lv';
    migrateLegacy();
    const stranger = signIn('google', 'g1', 'stranger@x.lv', '');
    expect(farmState(currentFarmOf(stranger)!.id).fields[0].name).not.toBe('Vecais lauks');
    const boss = signIn('google', 'g2', 'boss@farm.lv', '');
    const farm = currentFarmOf(boss)!.id;
    expect(farmState(farm).fields[0].name).toBe('Vecais lauks');
    expect(logList(farm).map((r) => r.id)).toEqual(['old']);
  });

  it('settings are saved per farm', () => {
    const a = signIn('google', 'g1', 'a@x.lv', '');
    const f = currentFarmOf(a)!.id;
    saveFarmState(f, { ...defaultState(), selectedProductIds: ['p1'] });
    expect(farmState(f).selectedProductIds).toEqual(['p1']);
  });
});
