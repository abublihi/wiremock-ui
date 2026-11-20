import {
  AUDIT_RETENTION_MS,
  clampAuditLimit,
  decodeAuditCursor,
  encodeAuditCursor,
  formatAuditSeq,
  type AuditEntry,
  type AuditLog,
  type AuditPage,
} from '../../audit/log'
import type { SqliteDb } from './db'

type Row = { seq: number; at_ms: number; json: string }

/** Same contract as the Redis log: newest first by (time, sequence), the same opaque cursor, 30-day retention on write. */
export class SqliteAuditLog implements AuditLog {
  constructor(private readonly sql: SqliteDb) {}

  async record(entry: Omit<AuditEntry, 'at'>): Promise<void> {
    const now = Date.now()
    const full: AuditEntry = { at: new Date(now).toISOString(), ...entry }
    this.sql.tx(() => {
      this.sql.stmt('INSERT INTO audit_log (at_ms, json) VALUES (?, ?)').run(now, JSON.stringify(full))
      this.sql.stmt('DELETE FROM audit_log WHERE at_ms < ?').run(now - AUDIT_RETENTION_MS)
    })
  }

  async list(opts: { limit?: number; cursor?: string } = {}): Promise<AuditPage> {
    const limit = clampAuditLimit(opts.limit)
    let rows: Row[]
    if (opts.cursor) {
      const from = decodeAuditCursor(opts.cursor)
      const score = BigInt(from.score)
      rows = this.sql
        .stmt(
          `SELECT seq, at_ms, json FROM audit_log WHERE at_ms < ? OR (at_ms = ? AND seq < ?)
           ORDER BY at_ms DESC, seq DESC LIMIT ?`,
        )
        .all(score, score, BigInt(from.seq), limit + 1) as Row[]
    } else {
      rows = this.sql
        .stmt('SELECT seq, at_ms, json FROM audit_log ORDER BY at_ms DESC, seq DESC LIMIT ?')
        .all(limit + 1) as Row[]
    }
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      entries: page.map((r) => JSON.parse(r.json) as AuditEntry),
      nextCursor: rows.length > limit && last ? encodeAuditCursor(last.at_ms, formatAuditSeq(last.seq)) : null,
    }
  }
}
