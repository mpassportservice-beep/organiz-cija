import { defaultState, normalizeState, type AppState } from '@spray/shared';
import { config } from './config';
import { db, kvGet, kvSet } from './db';

export type Role = 'owner' | 'member';
export interface User { id: number; email: string; name: string; currentFarmId: number | null }
export interface FarmRow { id: number; name: string; role: Role }

const now = () => new Date().toISOString();
export const normEmail = (e: string) => e.trim().toLowerCase();

function rowToUser(r: any): User {
  return { id: r.id, email: r.email, name: r.name, currentFarmId: r.current_farm_id ?? null };
}
export function userById(id: number): User | null {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return r ? rowToUser(r) : null;
}

/**
 * Data from before accounts existed (one shared farm) becomes farm #1. It is handed to the account whose e-mail is
 * OWNER_EMAIL; without OWNER_EMAIL, to the very first account that signs in.
 */
export function migrateLegacy(): void {
  const any = db.prepare('SELECT COUNT(*) AS n FROM farms').get() as { n: number };
  if (any.n > 0) return;
  const legacyState = kvGet<AppState>('state');
  const hasLogs = (db.prepare('SELECT COUNT(*) AS n FROM logs').get() as { n: number }).n > 0;
  if (!legacyState && !hasLogs) return;
  const st = normalizeState(legacyState);
  const r = db.prepare('INSERT INTO farms (name, state, created_at) VALUES (?, ?, ?)').run(st.location?.name || 'Mana saimniecība', JSON.stringify(st), now());
  const id = Number(r.lastInsertRowid);
  db.prepare('UPDATE logs SET farm_id = ? WHERE farm_id IS NULL').run(id);
  db.prepare('UPDATE push_subs SET farm_id = ? WHERE farm_id IS NULL').run(id);
  kvSet('legacyFarm', id);
}

function claimLegacy(user: User): number | null {
  const id = kvGet<number>('legacyFarm');
  if (!id) return null;
  const owners = db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE farm_id = ? AND role = 'owner'").get(id) as { n: number };
  if (owners.n > 0) return null;
  const want = config.ownerEmail ? normEmail(config.ownerEmail) : null;
  if (want && want !== user.email) return null;
  db.prepare("INSERT OR IGNORE INTO memberships (farm_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(id, user.id, now());
  kvSet('legacyFarm', null);
  return id;
}

export function createFarm(userId: number, name: string): number {
  const r = db.prepare('INSERT INTO farms (name, state, created_at) VALUES (?, ?, ?)').run(name, JSON.stringify(defaultState()), now());
  const id = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO memberships (farm_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(id, userId, now());
  return id;
}

/** Turn pending invitations for this e-mail into memberships. */
function acceptInvites(user: User): number[] {
  const rows = db.prepare('SELECT farm_id FROM invites WHERE email = ?').all(user.email) as { farm_id: number }[];
  for (const r of rows) {
    db.prepare("INSERT OR IGNORE INTO memberships (farm_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)").run(r.farm_id, user.id, now());
  }
  db.prepare('DELETE FROM invites WHERE email = ?').run(user.email);
  return rows.map((r) => r.farm_id);
}

export function farmsOf(userId: number): FarmRow[] {
  return db.prepare('SELECT f.id, f.name, m.role FROM memberships m JOIN farms f ON f.id = m.farm_id WHERE m.user_id = ? ORDER BY f.id')
    .all(userId) as unknown as FarmRow[];
}
export function roleIn(userId: number, farmId: number): Role | null {
  const r = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND farm_id = ?').get(userId, farmId) as { role: Role } | undefined;
  return r?.role ?? null;
}

/**
 * Called after a provider token has been verified. Finds the account by (provider, subject), else by verified
 * e-mail (so Google and Apple sign-ins with the same address share one account), else creates it.
 * Makes sure the user ends up with a current farm.
 */
export function signIn(provider: string, subject: string, email: string, name: string): User {
  email = normEmail(email);
  const ident = db.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').get(provider, subject) as { user_id: number } | undefined;
  let user: User | null = ident ? userById(ident.user_id) : null;
  if (!user) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (byEmail) user = rowToUser(byEmail);
    else {
      const r = db.prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)').run(email, name.slice(0, 120), now());
      user = userById(Number(r.lastInsertRowid))!;
    }
    db.prepare('INSERT OR IGNORE INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').run(provider, subject, user.id, now());
  }
  if (name && !user.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.slice(0, 120), user.id);
  if (email !== user.email && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id); // provider e-mail changed
  }
  const legacy = claimLegacy(userById(user.id)!);
  const joined = acceptInvites(userById(user.id)!);
  let farms = farmsOf(user.id);
  if (!farms.length) createFarm(user.id, 'Mana saimniecība');
  farms = farmsOf(user.id);
  const current = userById(user.id)!.currentFarmId;
  const pick = legacy ?? joined[0] ?? (current && farms.some((f) => f.id === current) ? current : farms[0].id);
  db.prepare('UPDATE users SET current_farm_id = ? WHERE id = ?').run(pick, user.id);
  return userById(user.id)!;
}

/** The farm a request works on: the user's current farm if they are still a member, else their first farm. */
export function currentFarmOf(user: User): FarmRow | null {
  const farms = farmsOf(user.id);
  const f = farms.find((x) => x.id === user.currentFarmId) ?? farms[0] ?? null;
  if (f && f.id !== user.currentFarmId) db.prepare('UPDATE users SET current_farm_id = ? WHERE id = ?').run(f.id, user.id);
  if (f) db.prepare('UPDATE farms SET last_seen = ? WHERE id = ?').run(now(), f.id);
  return f;
}

export function farmState(farmId: number): AppState {
  const r = db.prepare('SELECT state FROM farms WHERE id = ?').get(farmId) as { state: string | null } | undefined;
  return normalizeState(r?.state ? JSON.parse(r.state) : null);
}
export function saveFarmState(farmId: number, s: AppState): void {
  db.prepare('UPDATE farms SET state = ? WHERE id = ?').run(JSON.stringify(s), farmId);
}

export function members(farmId: number) {
  return {
    members: db.prepare('SELECT u.id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.farm_id = ? ORDER BY m.role DESC, u.email')
      .all(farmId) as { id: number; email: string; name: string; role: Role }[],
    invites: db.prepare('SELECT email, created_at AS createdAt FROM invites WHERE farm_id = ? ORDER BY email').all(farmId) as { email: string; createdAt: string }[],
  };
}

export function renameFarm(farmId: number, name: string) {
  db.prepare('UPDATE farms SET name = ? WHERE id = ?').run(name.trim().slice(0, 80) || 'Saimniecība', farmId);
}

/** Owner invites by e-mail. An existing account joins at once; otherwise it joins on first sign-in. */
export function invite(farmId: number, email: string, by: number): 'added' | 'invited' | 'already' {
  email = normEmail(email);
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
  if (u) {
    if (roleIn(u.id, farmId)) return 'already';
    db.prepare("INSERT INTO memberships (farm_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)").run(farmId, u.id, now());
    return 'added';
  }
  db.prepare('INSERT OR IGNORE INTO invites (farm_id, email, invited_by, created_at) VALUES (?, ?, ?, ?)').run(farmId, email, by, now());
  return 'invited';
}
export function cancelInvite(farmId: number, email: string) {
  db.prepare('DELETE FROM invites WHERE farm_id = ? AND email = ?').run(farmId, normEmail(email));
}

const ownerCount = (farmId: number) =>
  (db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE farm_id = ? AND role = 'owner'").get(farmId) as { n: number }).n;

/** Remove someone from a farm. The last owner cannot leave a farm that still has other members. */
export function removeMember(farmId: number, userId: number): 'ok' | 'lastOwner' {
  if (roleIn(userId, farmId) === 'owner' && ownerCount(farmId) <= 1) {
    const others = (db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE farm_id = ? AND user_id != ?').get(farmId, userId) as { n: number }).n;
    if (others > 0) return 'lastOwner';
  }
  db.prepare('DELETE FROM memberships WHERE farm_id = ? AND user_id = ?').run(farmId, userId);
  deleteFarmIfEmpty(farmId);
  return 'ok';
}

export function setRole(farmId: number, userId: number, role: Role): 'ok' | 'lastOwner' {
  if (role === 'member' && roleIn(userId, farmId) === 'owner' && ownerCount(farmId) <= 1) return 'lastOwner';
  db.prepare('UPDATE memberships SET role = ? WHERE farm_id = ? AND user_id = ?').run(role, farmId, userId);
  return 'ok';
}

function deleteFarmIfEmpty(farmId: number) {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE farm_id = ?').get(farmId) as { n: number }).n;
  if (n > 0) return;
  db.prepare('DELETE FROM logs WHERE farm_id = ?').run(farmId);
  db.prepare('DELETE FROM push_subs WHERE farm_id = ?').run(farmId);
  db.prepare('DELETE FROM farms WHERE id = ?').run(farmId);
}

/**
 * Delete an account. Farms where it is the only owner pass to the longest-standing other member;
 * farms with nobody else are deleted with their log.
 */
export function deleteAccount(userId: number): void {
  for (const f of farmsOf(userId)) {
    if (f.role === 'owner' && ownerCount(f.id) <= 1) {
      const heir = db.prepare('SELECT user_id FROM memberships WHERE farm_id = ? AND user_id != ? ORDER BY created_at LIMIT 1').get(f.id, userId) as { user_id: number } | undefined;
      if (heir) db.prepare("UPDATE memberships SET role = 'owner' WHERE farm_id = ? AND user_id = ?").run(f.id, heir.user_id);
    }
    db.prepare('DELETE FROM memberships WHERE farm_id = ? AND user_id = ?').run(f.id, userId);
    deleteFarmIfEmpty(f.id);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId); // identities and sessions cascade
}
