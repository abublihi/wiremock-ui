import type { CatalogStore, Endpoint, Integration } from '../../catalog/types'
import type { SqliteDb } from './db'

type JsonRow = { json: string }

// Sorted in JS, not SQL, so the order is exactly the Redis driver's (UTF-16 code units).
const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

export class SqliteCatalogStore implements CatalogStore {
  constructor(private readonly sql: SqliteDb) {}

  async getIntegration(key: string): Promise<Integration | null> {
    const row = this.sql.stmt('SELECT json FROM integrations WHERE key = ?').get(key) as JsonRow | undefined
    return row ? (JSON.parse(row.json) as Integration) : null
  }

  async listIntegrations(): Promise<Integration[]> {
    return (this.sql.stmt('SELECT json FROM integrations').all() as JsonRow[])
      .map((r) => JSON.parse(r.json) as Integration)
      .sort(byKey)
  }

  async putIntegration(i: Integration): Promise<void> {
    this.sql
      .stmt('INSERT INTO integrations (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json')
      .run(i.key, JSON.stringify(i))
  }

  async deleteIntegration(key: string): Promise<void> {
    this.sql.tx(() => {
      this.sql.stmt('DELETE FROM endpoints WHERE integration = ?').run(key)
      this.sql.stmt('DELETE FROM integrations WHERE key = ?').run(key)
    })
  }

  async getEndpoint(integration: string, key: string): Promise<Endpoint | null> {
    const row = this.sql.stmt('SELECT json FROM endpoints WHERE integration = ? AND key = ?').get(integration, key) as
      | JsonRow
      | undefined
    return row ? (JSON.parse(row.json) as Endpoint) : null
  }

  async listEndpoints(integration: string): Promise<Endpoint[]> {
    return (this.sql.stmt('SELECT json FROM endpoints WHERE integration = ?').all(integration) as JsonRow[])
      .map((r) => JSON.parse(r.json) as Endpoint)
      .sort(byKey)
  }

  async putEndpoint(e: Endpoint): Promise<void> {
    this.sql
      .stmt(
        `INSERT INTO endpoints (integration, key, json) VALUES (?, ?, ?)
         ON CONFLICT (integration, key) DO UPDATE SET json = excluded.json`,
      )
      .run(e.integration, e.key, JSON.stringify(e))
  }

  async deleteEndpoint(integration: string, key: string): Promise<void> {
    this.sql.stmt('DELETE FROM endpoints WHERE integration = ? AND key = ?').run(integration, key)
  }
}
