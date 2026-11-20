import type { Redis } from 'ioredis'
import { ValidationError } from '../errors'
import { logger } from '../logger'

export type AuditEntry = {
  at: string
  actor: string
  action: string
  target?: string
  details?: Record<string, unknown>
}

export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null }

export interface AuditLog {
  record(entry: Omit<AuditEntry, 'at'>): Promise<void>
  /**
   * Newest first. Default limit 100, max 500. `cursor` is the `nextCursor` of the previous page:
   * an opaque (score, sequence) position, so entries from the same millisecond are never skipped.
   */
  list(opts?: { limit?: number; cursor?: string }): Promise<AuditPage>
}

const KEY = 'audit:log'
const SEQ_KEY = 'audit:seq'
export const AUDIT_RETENTION_MS = 2_592_000_000 // 30 days
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const SEQ_DIGITS = 16

export const clampAuditLimit = (limit: number | undefined) => Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

/** Zero-padded so same-score members sort in write order. */
export const formatAuditSeq = (seq: number | bigint) => String(seq).padStart(SEQ_DIGITS, '0')

// KEYS: audit:log. ARGV: count, cursor score ('' = from the newest), cursor sequence.
// Returns flat [member, score, ...]: members at the cursor score with a smaller sequence, then older scores.
const PAGE_LUA = `
local n = tonumber(ARGV[1])
local out = {}
local max = "+inf"
if ARGV[2] ~= "" then
  local same = redis.call("zrevrangebyscore", KEYS[1], ARGV[2], ARGV[2])
  for _, m in ipairs(same) do
    if string.sub(m, 1, ${SEQ_DIGITS}) < ARGV[3] then
      table.insert(out, m)
      table.insert(out, ARGV[2])
      if #out >= 2 * n then return out end
    end
  end
  max = "(" .. ARGV[2]
end
local rest = redis.call("zrevrangebyscore", KEYS[1], max, "-inf", "WITHSCORES", "LIMIT", 0, n - #out / 2)
for _, v in ipairs(rest) do table.insert(out, v) end
return out`

/** The opaque cursor every driver hands out: base64url of `{epoch ms}:{16-digit sequence}`. */
export const encodeAuditCursor = (score: string | number, seq: string) =>
  Buffer.from(`${score}:${seq}`).toString('base64url')

export function decodeAuditCursor(cursor: string): { score: string; seq: string } {
  const m = /^(\d{1,16}):(\d{16})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (!m) throw new ValidationError('cursor is invalid')
  return { score: m[1], seq: m[2] }
}

export class RedisAuditLog implements AuditLog {
  constructor(private readonly redis: Redis) {}

  async record(entry: Omit<AuditEntry, 'at'>): Promise<void> {
    const now = Date.now()
    const full: AuditEntry = { at: new Date(now).toISOString(), ...entry }
    // A zero-padded sequence keeps identical entries distinct and, as same-score members sort
    // lexicographically, makes entries from the same millisecond come back in write order.
    const seq = await this.redis.incr(SEQ_KEY)
    const member = `${formatAuditSeq(seq)}${JSON.stringify(full)}`
    const m = this.redis.multi()
    m.zadd(KEY, now, member)
    m.zremrangebyscore(KEY, '-inf', `(${now - AUDIT_RETENTION_MS}`)
    await m.exec()
  }

  async list(opts: { limit?: number; cursor?: string } = {}): Promise<AuditPage> {
    const limit = clampAuditLimit(opts.limit)
    const from = opts.cursor ? decodeAuditCursor(opts.cursor) : { score: '', seq: '' }
    const flat = (await this.redis.eval(PAGE_LUA, 1, KEY, limit + 1, from.score, from.seq)) as string[]
    const rows: { member: string; score: string }[] = []
    for (let i = 0; i < flat.length; i += 2) rows.push({ member: flat[i], score: flat[i + 1] })
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      entries: page.map((r) => JSON.parse(r.member.slice(r.member.indexOf('{'))) as AuditEntry),
      nextCursor: rows.length > limit && last ? encodeAuditCursor(last.score, last.member.slice(0, SEQ_DIGITS)) : null,
    }
  }
}

/** Records an audit entry for a change that already happened: a failing audit log is logged, never thrown. */
export async function safeRecord(audit: AuditLog | undefined, entry: Omit<AuditEntry, 'at'>): Promise<void> {
  if (!audit) return
  try {
    await audit.record(entry)
  } catch (err) {
    logger.error({ err, action: entry.action, target: entry.target }, 'audit record failed')
  }
}
