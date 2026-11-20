import type { Redis } from 'ioredis'
import type { SqliteDb } from '../store/sqlite/db'
import { summaryOf, type ActiveRecording, type Recording, type RecordingStore, type RecordingSummary } from './types'

const key = (id: string) => `recording:${id}`
/** The list without its rows, kept beside it so listing never loads recorded bodies. */
const summaryKey = (id: string) => `recording-summary:${id}`
// Named like the other indexes (stubs:all, integrations:all).
const INDEX = 'recordings:all'
const ACTIVE = 'recordings:active'
const expiry = (r: Recording) => Date.parse(r.expiresAt)
const newestFirst = (a: Pick<Recording, 'createdAt'>, b: Pick<Recording, 'createdAt'>) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)

/** `recording:<id>` with an absolute expiry (PXAT) plus a sorted-set index pruned on read. */
export class RedisRecordingStore implements RecordingStore {
  constructor(private readonly redis: Redis) {}

  async put(r: Recording): Promise<void> {
    const at = expiry(r)
    if (at <= Date.now()) return this.delete(r.id)
    const m = this.redis.multi()
    m.set(key(r.id), JSON.stringify(r), 'PX', at - Date.now())
    m.set(summaryKey(r.id), JSON.stringify(summaryOf(r)), 'PX', at - Date.now())
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

  async listSummaries(): Promise<RecordingSummary[]> {
    await this.redis.zremrangebyscore(INDEX, '-inf', String(Date.now()))
    const ids = await this.redis.zrange(INDEX, '0', '-1')
    if (ids.length === 0) return []
    const jsons = await this.redis.mget(ids.map(summaryKey))
    const out: RecordingSummary[] = []
    for (const [i, json] of jsons.entries()) {
      if (json !== null) out.push(JSON.parse(json) as RecordingSummary)
      else {
        // Written before summaries were kept (or already expired): read the list itself.
        const full = await this.get(ids[i])
        if (full) out.push(summaryOf(full))
      }
    }
    return out.sort(newestFirst)
  }

  async delete(id: string): Promise<void> {
    const m = this.redis.multi()
    m.del(key(id))
    m.del(summaryKey(id))
    m.zrem(INDEX, id)
    await m.exec()
  }

  async getActive(): Promise<ActiveRecording | null> {
    const json = await this.redis.get(ACTIVE)
    return json ? (JSON.parse(json) as ActiveRecording) : null
  }

  async setActive(active: ActiveRecording | null): Promise<void> {
    if (active) await this.redis.set(ACTIVE, JSON.stringify(active))
    else await this.redis.del(ACTIVE)
  }
}

/** One row per review list; expired rows are deleted when the store opens, on every write and on list. */
export class SqliteRecordingStore implements RecordingStore {
  constructor(private readonly sql: SqliteDb) {
    this.purge()
  }

  private purge(): void {
    this.sql.stmt('DELETE FROM recordings WHERE expires_at <= ?').run(Date.now())
  }

  async put(r: Recording): Promise<void> {
    this.purge()
    this.sql
      .stmt('INSERT INTO recordings (id, json, expires_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at')
      .run(r.id, JSON.stringify(r), expiry(r))
  }

  async get(id: string): Promise<Recording | null> {
    const row = this.sql.stmt('SELECT json FROM recordings WHERE id = ? AND expires_at > ?').get(id, Date.now()) as { json: string } | undefined
    return row ? (JSON.parse(row.json) as Recording) : null
  }

  async list(): Promise<Recording[]> {
    this.purge()
    return (this.sql.stmt('SELECT json FROM recordings').all() as { json: string }[])
      .map((row) => JSON.parse(row.json) as Recording)
      .sort(newestFirst)
  }

  async listSummaries(): Promise<RecordingSummary[]> {
    this.purge()
    // SQLite takes the rows out of the JSON, so recorded bodies never reach JavaScript.
    return (this.sql.stmt("SELECT json_remove(json, '$.items') AS summary, json_array_length(json, '$.items') AS n FROM recordings").all() as { summary: string; n: number }[])
      .map((row) => ({ ...(JSON.parse(row.summary) as Omit<Recording, 'items'>), itemCount: row.n }))
      .sort(newestFirst)
  }

  async delete(id: string): Promise<void> {
    this.sql.stmt('DELETE FROM recordings WHERE id = ?').run(id)
  }

  async getActive(): Promise<ActiveRecording | null> {
    const row = this.sql.stmt('SELECT json FROM recording_active WHERE id = 1').get() as { json: string } | undefined
    return row ? (JSON.parse(row.json) as ActiveRecording) : null
  }

  async setActive(active: ActiveRecording | null): Promise<void> {
    if (active) {
      this.sql.stmt('INSERT INTO recording_active (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json').run(JSON.stringify(active))
    } else this.sql.stmt('DELETE FROM recording_active').run()
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

  async listSummaries(): Promise<RecordingSummary[]> {
    this.purge()
    return [...this.items.values()].map((r) => structuredClone(summaryOf(r))).sort(newestFirst)
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id)
  }

  private active: ActiveRecording | null = null

  async getActive(): Promise<ActiveRecording | null> {
    return this.active
  }

  async setActive(active: ActiveRecording | null): Promise<void> {
    this.active = active
  }
}
