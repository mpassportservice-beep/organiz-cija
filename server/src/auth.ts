import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { config } from './config';
import { db } from './db';

/**
 * Sign-in with Google and Apple (OpenID Connect).
 * The browser gets an ID token (a JWT signed by Google/Apple) and sends it here; the server checks the signature
 * against the provider's published keys, the issuer, the audience (our client id), expiry and a one-time nonce,
 * then takes the stable user id ("sub") and the e-mail from it. Nothing else from the browser is trusted.
 */

export interface Provider {
  id: 'google' | 'apple';
  issuers: string[];
  audience: string;
  keys: JWTVerifyGetKey;
}

const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_KEYS = 'https://appleid.apple.com/auth/keys';
let googleKeys: JWTVerifyGetKey | null = null;
let appleKeys: JWTVerifyGetKey | null = null;

export function providers(): Partial<Record<'google' | 'apple', Provider>> {
  const out: Partial<Record<'google' | 'apple', Provider>> = {};
  if (config.auth.googleClientId) {
    googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_KEYS));
    out.google = { id: 'google', issuers: ['https://accounts.google.com', 'accounts.google.com'], audience: config.auth.googleClientId, keys: googleKeys };
  }
  if (config.auth.appleClientId) {
    appleKeys ??= createRemoteJWKSet(new URL(APPLE_KEYS));
    out.apple = { id: 'apple', issuers: ['https://appleid.apple.com'], audience: config.auth.appleClientId, keys: appleKeys };
  }
  return out;
}

export interface VerifiedIdentity { provider: 'google' | 'apple'; subject: string; email: string; name: string }

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const truthy = (v: unknown) => v === true || v === 'true';

/** Verify an ID token. Throws with a short reason when anything is off. */
export async function verifyIdToken(p: Provider, token: string, expectedNonce: string | null): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(token, p.keys, {
    issuer: p.issuers, audience: p.audience, algorithms: ['RS256', 'ES256'], clockTolerance: 60, maxTokenAge: '1h',
  });
  const c = payload as JWTPayload & { email?: string; email_verified?: boolean | string; nonce?: string; name?: string };
  if (!c.sub) throw new Error('token has no subject');
  // Nonce ties the token to the sign-in this browser started; Apple may return it hashed.
  if (!expectedNonce || (c.nonce !== expectedNonce && c.nonce !== sha256(expectedNonce))) throw new Error('nonce mismatch');
  if (!c.email) throw new Error('token has no e-mail');
  if (!truthy(c.email_verified)) throw new Error('e-mail not verified');
  return { provider: p.id, subject: c.sub, email: c.email, name: typeof c.name === 'string' ? c.name : '' };
}

// ---- one-time nonces ----
export function newNonce(): string {
  const n = crypto.randomBytes(24).toString('base64url');
  db.prepare('DELETE FROM auth_nonces WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO auth_nonces (nonce, expires_at) VALUES (?, ?)').run(n, new Date(Date.now() + 10 * 60_000).toISOString());
  return n;
}
/** True once per issued, unexpired nonce. */
export function useNonce(n: string | undefined): boolean {
  if (!n) return false;
  const r = db.prepare('DELETE FROM auth_nonces WHERE nonce = ? AND expires_at >= ?').run(n, new Date().toISOString());
  return r.changes > 0;
}

// ---- sessions ----
export const SESSION_COOKIE = 'sid';
export const NONCE_COOKIE = 'auth_nonce';
const SESSION_DAYS = 90;

export function createSession(userId: number): { token: string; maxAge: number } {
  const token = crypto.randomBytes(32).toString('base64url');
  const created = new Date();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, created.toISOString(), new Date(created.getTime() + SESSION_DAYS * 86_400_000).toISOString());
  return { token, maxAge: SESSION_DAYS * 86_400 };
}
export function sessionUser(token: string | undefined): number | null {
  if (!token) return null;
  const r = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as { user_id: number; expires_at: string } | undefined;
  if (!r) return null;
  if (Date.parse(r.expires_at) < Date.now()) { endSession(token); return null; }
  return r.user_id;
}
export function endSession(token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}
export function endAllSessions(userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
