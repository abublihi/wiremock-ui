import type { Redis } from 'ioredis'
import type { SqliteDb } from '../store/sqlite/db'
import type { Recording, RecordingStore } from './types'

const key = (id: string) => `recording:${id}`
const INDEX = 'recordings'
const expiry = (r: Recording) => Date.parse(r.expiresAt)
const newestFirst = (a: Recording, b: Recording) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)

/** `recording:<id>` with an absolute expiry (PXAT) plus a sorted-set index pruned on read. */
export class RedisRecordingStore implements RecordingStore {
  constructor(private readonly redis: Redis) {}

  async put(r: Recording): Promise<void> {
    const at = expiry(r)
    if (at <= Date.now()) return this.delete(r.id)
    const m = this.redis.multi()
    m.set(key(r.id), JSON.stringify(r), 'PX', at - Date.now())
    m.zadd(INDEX, at, r.id)
    await m.exec()
  }

  async get(id: string): Promise<Recording | null> {
    const json = await this.redis.get(key(id))
    return json ? (JSON.parse(json) as Recording) : null
  }

  async list(): Promise<Recording[]> {
    await this.redis.zremrangebyscore(INDEX, '-inf', String(Date.now()))
    const ids = await this.redis.zrange(INDEX, '0', '-1')
    if (ids.length === 0) return []
    const jsons = await this.redis.mget(ids.map(key))
    const gone = ids.filter((_, i) => jsons[i] === null)
    if (gone.length > 0) await this.redis.zrem(INDEX, ...gone)
    return jsons
      .filter((j): j is string => j !== null)
      .map((j) => JSON.parse(j) as Recording)
      .sort(newestFirst)
  }

  async delete(id: string): Promise<void> {
    const m = this.redis.multi()
    m.del(key(id))
    m.zrem(INDEX, id)
    await m.exec()
  }
}

/** One row per review list; expired rows are deleted on read. */
export class SqliteRecordingStore implements RecordingStore {
  constructor(private readonly sql: SqliteDb) {}

  async put(r: Recording): Promise<void> {
    this.sql
      .stmt('INSERT INTO recordings (id, json, expires_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at')
      .run(r.id, JSON.stringify(r), expiry(r))
  }

  async get(id: string): Promise<Recording | null> {
    const row = this.sql.stmt('SELECT json FROM recordings WHERE id = ? AND expires_at > ?').get(id, Date.now()) as { json: string } | undefined
    return row ? (JSON.parse(row.json) as Recording) : null
  }

  async list(): Promise<Recording[]> {
    this.sql.stmt('DELETE FROM recordings WHERE expires_at <= ?').run(Date.now())
    return (this.sql.stmt('SELECT json FROM recordings').all() as { json: string }[])
      .map((row) => JSON.parse(row.json) as Recording)
      .sort(newestFirst)
  }

  async delete(id: string): Promise<void> {
    this.sql.stmt('DELETE FROM recordings WHERE id = ?').run(id)
  }
}

/** WireMock-only mode (spec A10): review lists live in memory and are lost on restart. */
export class MemoryRecordingStore implements RecordingStore {
  private readonly items = new Map<string, Recording>()

  private purge(): void {
    const now = Date.now()
    for (const [id, r] of this.items) if (expiry(r) <= now) this.items.delete(id)
  }

  async put(r: Recording): Promise<void> {
    this.items.set(r.id, structuredClone(r))
    this.purge()
  }

  async get(id: string): Promise<Recording | null> {
    this.purge()
    const r = this.items.get(id)
    return r ? structuredClone(r) : null
  }

  async list(): Promise<Recording[]> {
    this.purge()
    return [...this.items.values()].map((r) => structuredClone(r)).sort(newestFirst)
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }
}
