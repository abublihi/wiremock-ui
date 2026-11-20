import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

export const SCHEMA_VERSION = 1

// Version 1. JSON documents are stored as TEXT; anything filtered, sorted or expired on has a column.
// Times used for expiry are epoch milliseconds; a NULL expires_at never expires.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS stubs (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  integration TEXT,
  owner TEXT,
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS stubs_by_integration ON stubs (integration);
CREATE INDEX IF NOT EXISTS stubs_by_owner ON stubs (owner);
CREATE INDEX IF NOT EXISTS stubs_by_updated_at ON stubs (updated_at);

CREATE TABLE IF NOT EXISTS stub_history (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  stub_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stub_history_by_stub ON stub_history (stub_id, seq);

-- A stub's whole history expires together, like the Redis list's TTL.
CREATE TABLE IF NOT EXISTS stub_history_expiry (
  stub_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stub_history_expiry_by_time ON stub_history_expiry (expires_at);

CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username_lower TEXT NOT NULL UNIQUE,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_rate_limits (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_by_time ON audit_log (at_ms, seq);

CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flags (name TEXT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS endpoints (
  integration TEXT NOT NULL,
  key TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (integration, key)
);
`

const isThenable = (value: unknown): boolean =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function'

/**
 * One SQLite file shared by every store. `node:sqlite` is synchronous, so inside one process
 * nothing interleaves with a transaction; `BEGIN IMMEDIATE` plus busy_timeout covers other processes.
 */
export class SqliteDb {
  readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private closed = false

  constructor(path: string) {
    if (path !== ':memory:') {
      // The file holds password hashes and sessions: owner-only directory (when we create it) and file.
      // SQLite creates the -wal and -shm files with the database file's permissions.
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      closeSync(openSync(path, 'a', 0o600))
      chmodSync(path, 0o600)
    }
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout = 5000')
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec('PRAGMA synchronous = NORMAL')
      this.tx(() => {
        this.db.exec(SCHEMA)
        const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
        if (row.v === null) this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION)
        else if (row.v > SCHEMA_VERSION) {
          throw new Error(`database schema version ${row.v} is newer than this app supports (${SCHEMA_VERSION})`)
        }
      })
    } catch (err) {
      this.db.close()
      throw err
    }
  }

  /** Cached prepared statement. */
  stmt(sql: string): StatementSync {
    let s = this.statements.get(sql)
    if (!s) {
      s = this.db.prepare(sql)
      this.statements.set(sql, s)
    }
    return s
  }

  /** Runs `fn` in one write transaction. `fn` must be synchronous: a promise would commit before its work ran. */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      if (isThenable(out)) throw new TypeError('SqliteDb.tx callback must be synchronous')
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // SQLite may already have rolled back (e.g. after SQLITE_FULL); never mask the original error.
      }
      throw err
    }
  }

  ping(): boolean {
    if (this.closed) return false
    try {
      return (this.stmt('SELECT 1 AS ok').get() as { ok: number }).ok === 1
    } catch {
      return false
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.db.close()
  }
}
