import { randomUUID } from 'node:crypto'
import { ConflictError } from '../../errors'
import type { StubMapping } from '../../wiremock/types'
import type { MockStore } from '../types'
import type { SqliteDb } from './db'

const HISTORY_MAX = 20
const HISTORY_TTL_MS = 604_800_000 // 7 days

const metaOf = (s: StubMapping | null) => s?.metadata?.wiremockUi
const versionOf = (s: StubMapping | null) => metaOf(s)?.version ?? 0
const parse = (json: string) => JSON.parse(json) as StubMapping

type JsonRow = { json: string }

export class SqliteMockStore implements MockStore {
  constructor(private readonly sql: SqliteDb) {}

  async get(id: string): Promise<StubMapping | null> {
    const row = this.sql.stmt('SELECT json FROM stubs WHERE id = ?').get(id) as JsonRow | undefined
    return row ? parse(row.json) : null
  }

  async list(filter: { integration?: string; owner?: string } = {}): Promise<StubMapping[]> {
    const where: string[] = []
    const args: string[] = []
    if (filter.integration) {
      where.push('integration = ?')
      args.push(filter.integration)
    }
    if (filter.owner) {
      where.push('owner = ?')
      args.push(filter.owner)
    }
    const sql = `SELECT json FROM stubs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`
    return (this.sql.stmt(sql).all(...args) as JsonRow[]).map((r) => parse(r.json))
  }

  async listAll(): Promise<StubMapping[]> {
    return (this.sql.stmt('SELECT json FROM stubs').all() as JsonRow[]).map((r) => parse(r.json))
  }

  private purgeExpiredHistory(now: number): void {
    this.sql
      .stmt('DELETE FROM stub_history WHERE stub_id IN (SELECT stub_id FROM stub_history_expiry WHERE expires_at <= ?)')
      .run(now)
    this.sql.stmt('DELETE FROM stub_history_expiry WHERE expires_at <= ?').run(now)
  }

  private pushHistory(id: string, json: string): void {
    this.sql.stmt('INSERT INTO stub_history (stub_id, json) VALUES (?, ?)').run(id, json)
    this.sql
      .stmt(
        'DELETE FROM stub_history WHERE stub_id = ? AND seq NOT IN (SELECT seq FROM stub_history WHERE stub_id = ? ORDER BY seq DESC LIMIT ?)',
      )
      .run(id, id, HISTORY_MAX)
  }

  async save(stub: StubMapping, expectedVersion: number): Promise<void> {
    this.sql.tx(() => {
      const now = Date.now()
      this.purgeExpiredHistory(now)
      const oldRow = this.sql.stmt('SELECT json FROM stubs WHERE id = ?').get(stub.id) as JsonRow | undefined
      const old = oldRow ? parse(oldRow.json) : null
      if (versionOf(old) !== expectedVersion || (expectedVersion === 0 && old)) throw new ConflictError()
      const meta = metaOf(stub)
      this.sql
        .stmt(
          `INSERT INTO stubs (id, json, integration, owner, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET json = excluded.json, integration = excluded.integration,
             owner = excluded.owner, updated_at = excluded.updated_at`,
        )
        .run(stub.id, JSON.stringify(stub), meta?.integration || null, meta?.owner || null, meta?.updatedAt ?? '')
      if (oldRow) {
        this.pushHistory(stub.id, oldRow.json)
        this.sql.stmt('DELETE FROM stub_history_expiry WHERE stub_id = ?').run(stub.id)
      }
    })
  }

  async delete(id: string, expectedVersion?: number): Promise<void> {
    this.sql.tx(() => {
      const now = Date.now()
      this.purgeExpiredHistory(now)
      const oldRow = this.sql.stmt('SELECT json FROM stubs WHERE id = ?').get(id) as JsonRow | undefined
      if (!oldRow) return
      if (expectedVersion !== undefined && versionOf(parse(oldRow.json)) !== expectedVersion) {
        throw new ConflictError()
      }
      this.sql.stmt('DELETE FROM stubs WHERE id = ?').run(id)
      this.pushHistory(id, oldRow.json)
      this.sql
        .stmt(
          `INSERT INTO stub_history_expiry (stub_id, expires_at) VALUES (?, ?)
           ON CONFLICT (stub_id) DO UPDATE SET expires_at = excluded.expires_at`,
        )
        .run(id, now + HISTORY_TTL_MS)
    })
  }

  async history(id: string): Promise<StubMapping[]> {
    this.sql.tx(() => this.purgeExpiredHistory(Date.now()))
    return (
      this.sql.stmt('SELECT json FROM stub_history WHERE stub_id = ? ORDER BY seq DESC').all(id) as JsonRow[]
    ).map((r) => parse(r.json))
  }

  async acquireLock(name: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID()
    return this.sql.tx(() => {
      const now = Date.now()
      this.sql.stmt('DELETE FROM locks WHERE name = ? AND expires_at <= ?').run(name, now)
      const res = this.sql
        .stmt('INSERT INTO locks (name, token, expires_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING')
        .run(name, token, now + ttlMs)
      return res.changes === 1 ? token : null
    })
  }

  async releaseLock(name: string, token: string): Promise<void> {
    this.sql.stmt('DELETE FROM locks WHERE name = ? AND token = ?').run(name, token)
  }

  async getFlag(name: string): Promise<boolean> {
    return this.sql.stmt('SELECT 1 FROM flags WHERE name = ?').get(name) !== undefined
  }

  async setFlag(name: string, on: boolean): Promise<void> {
    if (on) this.sql.stmt('INSERT INTO flags (name) VALUES (?) ON CONFLICT (name) DO NOTHING').run(name)
    else this.sql.stmt('DELETE FROM flags WHERE name = ?').run(name)
  }

  async ping(): Promise<boolean> {
    return this.sql.ping()
  }

  /** The shared database is closed by its owner (`createStores`). */
  async close(): Promise<void> {}
}
