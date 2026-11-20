import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Redis } from 'ioredis'
import type { Config } from '../../src/server/config'
import { createStores, type Stores } from '../../src/server/store'
import { startRedis } from './containers'

export type DriverName = 'redis' | 'sqlite'

/** Driver-specific peeks and pokes, so one contract test body can check stored state on either driver. */
export type Probe = {
  /** Empties the store. */
  reset(): Promise<void>
  /** Seconds left, like Redis TTL: -1 = no expiry, -2 = missing. */
  historyTtl(stubId: string): Promise<number>
  sessionTtl(sessionId: string): Promise<number>
  userSessionsExist(userId: string): Promise<boolean>
  /** The username index: lower-cased name → user id. */
  nameIndex(): Promise<{ name: string; id: string }[]>
  /** True when nothing at all is stored. */
  isEmpty(): Promise<boolean>
  /** Raw login counter for an ip, null when absent. */
  rateLimit(ip: string): Promise<string | null>
  rateLimitTtl(ip: string): Promise<number>
  setRateLimitTtl(ip: string, seconds: number): Promise<void>
  /** Writes a counter without any window, as a manual SET or a restore would. */
  setRateLimitNoTtl(ip: string, count: number): Promise<void>
  /** Removes only the session record (simulates expiry). */
  deleteSessionRecord(id: string): Promise<void>
  /** Removes only the user record, leaving its sessions. */
  deleteUserRecord(id: string): Promise<void>
  /** Writes an audit entry at an arbitrary time, bypassing record(). */
  addAuditAt(ms: number, entry: Record<string, unknown>): Promise<void>
  auditCount(): Promise<number>
  catalogEmpty(): Promise<boolean>
}

export type StoreHarness = {
  driver: DriverName
  stores: Stores
  probe: Probe
  /** Redis only: the connection URL. */
  redisUrl?: string
  /** SQLite only: closes the stores and opens them again on the same file. */
  reopen?(): Stores
  stop(): Promise<void>
}

const cfg = (over: Partial<Config>) => over as Config

async function redisHarness(): Promise<StoreHarness> {
  const handle = await startRedis()
  const stores = createStores(cfg({ storeDriver: 'redis', redisUrl: handle.url }))
  const r = new Redis(handle.url)
  const ttl = (key: string) => r.ttl(key)
  const probe: Probe = {
    reset: async () => void (await r.flushdb()),
    historyTtl: (id) => ttl(`stub:${id}:history`),
    sessionTtl: (id) => ttl(`session:${id}`),
    userSessionsExist: async (id) => (await r.exists(`user:${id}:sessions`)) === 1,
    nameIndex: async () => {
      const keys = await r.keys('users:by-name:*')
      return Promise.all(
        keys.map(async (k) => ({ name: k.slice('users:by-name:'.length), id: (await r.get(k)) ?? '' })),
      )
    },
    isEmpty: async () => (await r.keys('*')).length === 0,
    rateLimit: (ip) => r.get(`ratelimit:login:${ip}`),
    rateLimitTtl: (ip) => ttl(`ratelimit:login:${ip}`),
    setRateLimitTtl: async (ip, s) => void (await r.expire(`ratelimit:login:${ip}`, s)),
    setRateLimitNoTtl: async (ip, n) => void (await r.set(`ratelimit:login:${ip}`, String(n))),
    deleteSessionRecord: async (id) => void (await r.del(`session:${id}`)),
    deleteUserRecord: async (id) => void (await r.del(`user:${id}`)),
    addAuditAt: async (ms, entry) => void (await r.zadd('audit:log', ms, JSON.stringify(entry))),
    auditCount: () => r.zcard('audit:log'),
    catalogEmpty: async () =>
      (await r.keys('*catalog*')).length === 0 && (await r.keys('integration*')).length === 0,
  }
  return {
    driver: 'redis',
    stores,
    probe,
    redisUrl: handle.url,
    async stop() {
      await stores.close()
      await r.quit()
      await handle.stop()
    },
  }
}

const TABLES = [
  'stubs',
  'stub_history',
  'stub_history_expiry',
  'locks',
  'users',
  'sessions',
  'login_rate_limits',
  'audit_log',
  'integrations',
  'endpoints',
  'flags',
]

function sqliteHarness(): StoreHarness {
  const dir = mkdtempSync(join(tmpdir(), 'wmui-sqlite-'))
  const path = join(dir, 'nested', 'wiremock-ui.db')
  const open = () => createStores(cfg({ storeDriver: 'sqlite', sqlitePath: path }))
  const harness: StoreHarness = {
    driver: 'sqlite',
    stores: open(),
    probe: undefined as unknown as Probe,
    reopen() {
      void harness.stores.close()
      harness.stores = open()
      return harness.stores
    },
    async stop() {
      await harness.stores.close()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
  // A second connection on the same file, as another process would see it.
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 5000')
  const one = <T>(sql: string, ...args: (string | number)[]) =>
    db.prepare(sql).get(...args) as T | undefined
  const ttlOf = (expiresAt: number | null | undefined, exists: boolean) =>
    !exists ? -2 : expiresAt === null || expiresAt === undefined ? -1 : Math.round((expiresAt - Date.now()) / 1000)
  harness.probe = {
    reset: async () => {
      for (const t of TABLES) db.exec(`DELETE FROM ${t}`)
      db.exec('DELETE FROM sqlite_sequence')
    },
    historyTtl: async (id) => {
      const rows = one<{ n: number }>('SELECT COUNT(*) AS n FROM stub_history WHERE stub_id = ?', id)?.n ?? 0
      const exp = one<{ expires_at: number }>('SELECT expires_at FROM stub_history_expiry WHERE stub_id = ?', id)
      return ttlOf(exp?.expires_at ?? null, rows > 0)
    },
    sessionTtl: async (id) => {
      const row = one<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE id = ?', id)
      return ttlOf(row?.expires_at, row !== undefined)
    },
    userSessionsExist: async (id) => one('SELECT 1 FROM sessions WHERE user_id = ?', id) !== undefined,
    nameIndex: async () =>
      (db.prepare('SELECT username_lower AS name, id FROM users').all() as { name: string; id: string }[]).map(
        (r) => ({ name: r.name, id: r.id }),
      ),
    isEmpty: async () =>
      TABLES.every((t) => (one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0) === 0),
    rateLimit: async (ip) => {
      const row = one<{ count: number }>('SELECT count FROM login_rate_limits WHERE ip = ?', ip)
      return row ? String(row.count) : null
    },
    rateLimitTtl: async (ip) => {
      const row = one<{ expires_at: number | null }>('SELECT expires_at FROM login_rate_limits WHERE ip = ?', ip)
      return ttlOf(row?.expires_at, row !== undefined)
    },
    setRateLimitTtl: async (ip, s) =>
      void db.prepare('UPDATE login_rate_limits SET expires_at = ? WHERE ip = ?').run(Date.now() + s * 1000, ip),
    setRateLimitNoTtl: async (ip, n) =>
      void db
        .prepare('INSERT INTO login_rate_limits (ip, count, expires_at) VALUES (?, ?, NULL) ON CONFLICT(ip) DO UPDATE SET count = excluded.count, expires_at = NULL')
        .run(ip, n),
    deleteSessionRecord: async (id) => void db.prepare('DELETE FROM sessions WHERE id = ?').run(id),
    deleteUserRecord: async (id) => void db.prepare('DELETE FROM users WHERE id = ?').run(id),
    addAuditAt: async (ms, entry) =>
      void db.prepare('INSERT INTO audit_log (at_ms, json) VALUES (?, ?)').run(ms, JSON.stringify(entry)),
    auditCount: async () => one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n ?? 0,
    catalogEmpty: async () =>
      (one<{ n: number }>('SELECT (SELECT COUNT(*) FROM integrations) + (SELECT COUNT(*) FROM endpoints) AS n')?.n ?? 0) === 0,
  }
  return harness
}

/** For `describe.each(drivers)`: every store contract runs against Redis and SQLite. */
export const drivers: [DriverName, () => Promise<StoreHarness>][] = [
  ['redis', redisHarness],
  ['sqlite', async () => sqliteHarness()],
]
