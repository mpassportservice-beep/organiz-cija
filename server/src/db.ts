import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LogRecord } from '@spray/shared';
import { config } from './config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  -- last GOOD payload per source + outcome of the last attempt
  CREATE TABLE IF NOT EXISTS source_cache (
    source TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT, attempted_at TEXT, ok INTEGER NOT NULL DEFAULT 0, error TEXT, detail TEXT);
  CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, record TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'lv', last_window TEXT);
`);

export function kvGet<T>(key: string): T | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}
export function kvSet(key: string, value: unknown): void {
  db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export interface SourceRow<T> { payload: T | null; fetchedAt: string | null; attemptedAt: string | null; ok: boolean; error: string | null; detail: string | null }

export function sourceGet<T>(source: string): SourceRow<T> {
  const r = db.prepare('SELECT * FROM source_cache WHERE source = ?').get(source) as any;
  if (!r) return { payload: null, fetchedAt: null, attemptedAt: null, ok: false, error: null, detail: null };
  return { payload: r.payload ? JSON.parse(r.payload) : null, fetchedAt: r.fetched_at, attemptedAt: r.attempted_at, ok: !!r.ok, error: r.error, detail: r.detail };
}
export function sourceOk(source: string, payload: unknown, detail: string | null): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO source_cache (source, payload, fetched_at, attempted_at, ok, error, detail) VALUES (?, ?, ?, ?, 1, NULL, ?)
    ON CONFLICT(source) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, attempted_at = excluded.attempted_at, ok = 1, error = NULL, detail = excluded.detail`)
    .run(source, JSON.stringify(payload), now, now, detail);
}
/** A failed attempt keeps the previous good payload; its own timestamps decide whether it is stale. */
export function sourceFail(source: string, error: string): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO source_cache (source, attempted_at, ok, error) VALUES (?, ?, 0, ?)
    ON CONFLICT(source) DO UPDATE SET attempted_at = excluded.attempted_at, ok = 0, error = excluded.error`).run(source, now, error);
}

export function logInsert(rec: LogRecord): void {
  db.prepare('INSERT OR REPLACE INTO logs (id, started_at, record) VALUES (?, ?, ?)').run(rec.id, rec.startedAt, JSON.stringify(rec));
}
export function logList(): LogRecord[] {
  return (db.prepare('SELECT record FROM logs ORDER BY started_at DESC').all() as { record: string }[]).map((r) => JSON.parse(r.record));
}
