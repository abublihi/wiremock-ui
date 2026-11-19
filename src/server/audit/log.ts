import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'

export type AuditEntry = {
  at: string
  actor: string
  action: string
  target?: string
  details?: Record<string, unknown>
}

export interface AuditLog {
  record(entry: Omit<AuditEntry, 'at'>): Promise<void>
  /** Newest first. Default limit 100, max 500. */
  list(opts?: { limit?: number; before?: string }): Promise<AuditEntry[]>
}

const KEY = 'audit:log'
const RETENTION_MS = 2_592_000_000 // 30 days
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export class RedisAuditLog implements AuditLog {
  constructor(private readonly redis: Redis) {}

  async record(entry: Omit<AuditEntry, 'at'>): Promise<void> {
    const now = Date.now()
    const full: AuditEntry = { at: new Date(now).toISOString(), ...entry }
    // A random prefix keeps identical entries from collapsing into one sorted-set member.
    const member = `${randomUUID()}${JSON.stringify(full)}`
    const m = this.redis.multi()
    m.zadd(KEY, now, member)
    m.zremrangebyscore(KEY, '-inf', `(${now - RETENTION_MS}`)
    await m.exec()
  }

  async list(opts: { limit?: number; before?: string } = {}): Promise<AuditEntry[]> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const beforeMs = opts.before ? Date.parse(opts.before) : Number.NaN
    const max = Number.isNaN(beforeMs) ? '+inf' : `(${beforeMs}`
    const members = await this.redis.zrevrangebyscore(KEY, max, '-inf', 'LIMIT', 0, limit)
    return members.map((m) => JSON.parse(m.slice(m.indexOf('{'))) as AuditEntry)
  }
}
