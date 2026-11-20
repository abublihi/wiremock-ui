import { randomBytes } from 'node:crypto'
import { clampAuditLimit, decodeAuditCursor, encodeAuditCursor, formatAuditSeq, type AuditEntry, type AuditLog, type AuditPage } from '../audit/log'
import type { CatalogStore, Endpoint, Integration } from '../catalog/types'
import { ConflictError, ValidationError } from '../errors'
import type { Session, User, UserStore } from '../users/types'

/** In-memory stores for WireMock-only mode (spec A10): everything here is lost on restart. */

export const NO_USER_MANAGEMENT = 'User management is not available in WireMock-only mode'

const token = () => randomBytes(32).toString('base64url')

/** Holds the bootstrap account only (ADMIN_USER / ADMIN_PASSWORD); sessions and the login rate limit live in memory. */
export class MemoryUserStore implements UserStore {
  private users = new Map<string, User>()
  private sessions = new Map<string, Session>()
  private limits = new Map<string, { count: number; expiresAt: number | null }>()

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null
  }

  async getUserByName(username: string): Promise<User | null> {
    const lower = username.toLowerCase()
    return [...this.users.values()].find((u) => u.username.toLowerCase() === lower) ?? null
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()].sort((a, b) => a.username.localeCompare(b.username, 'en', { sensitivity: 'base' }))
  }

  /** Only the first account (the bootstrap one) can be created. */
  async createUser(user: User): Promise<void> {
    if (this.users.size > 0) {
      if (await this.getUserByName(user.username)) throw new ConflictError('Username already exists')
      throw new ValidationError(NO_USER_MANAGEMENT)
    }
    this.users.set(user.id, user)
  }

  async updateUser(_user: User): Promise<void> {
    throw new ValidationError(NO_USER_MANAGEMENT)
  }

  async deleteUser(_id: string): Promise<void> {
    throw new ValidationError(NO_USER_MANAGEMENT)
  }

  async countUsers(): Promise<number> {
    return this.users.size
  }

  private purgeSessions(now: number): void {
    for (const [id, s] of this.sessions) if (Date.parse(s.expiresAt) <= now) this.sessions.delete(id)
  }

  async createSession(userId: string, ttlSeconds: number): Promise<Session> {
    const now = Date.now()
    this.purgeSessions(now)
    const session: Session = {
      id: token(),
      userId,
      csrfToken: token(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    }
    this.sessions.set(session.id, session)
    return session
  }

  async getSession(id: string): Promise<Session | null> {
    const s = this.sessions.get(id)
    return s && Date.parse(s.expiresAt) > Date.now() ? s : null
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
  }

  async deleteSessionsOf(userId: string): Promise<void> {
    for (const [id, s] of this.sessions) if (s.userId === userId) this.sessions.delete(id)
  }

  async deleteOtherSessions(userId: string, keepId: string): Promise<void> {
    for (const [id, s] of this.sessions) if (s.userId === userId && id !== keepId) this.sessions.delete(id)
  }

  private live(ip: string, now: number) {
    const entry = this.limits.get(ip)
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now) {
      this.limits.delete(ip)
      return undefined
    }
    return entry
  }

  async hitRateLimit(ip: string, windowSeconds: number): Promise<number> {
    const now = Date.now()
    for (const key of this.limits.keys()) this.live(key, now)
    const entry = this.live(ip, now) ?? { count: 0, expiresAt: null }
    entry.count++
    entry.expiresAt ??= now + windowSeconds * 1000
    this.limits.set(ip, entry)
    return entry.count
  }

  async releaseRateLimit(ip: string): Promise<void> {
    const entry = this.live(ip, Date.now())
    if (entry && entry.count > 0) entry.count--
  }
}

export const MEMORY_AUDIT_MAX = 500

/** The last 500 audit entries, newest first; same cursor format as the stored logs. */
export class MemoryAuditLog implements AuditLog {
  private entries: { seq: string; ms: number; entry: AuditEntry }[] = []
  private seq = 0

  async record(entry: Omit<AuditEntry, 'at'>): Promise<void> {
    const ms = Date.now()
    this.entries.push({ seq: formatAuditSeq(++this.seq), ms, entry: { at: new Date(ms).toISOString(), ...entry } })
    if (this.entries.length > MEMORY_AUDIT_MAX) this.entries.splice(0, this.entries.length - MEMORY_AUDIT_MAX)
  }

  async list(opts: { limit?: number; cursor?: string } = {}): Promise<AuditPage> {
    const limit = clampAuditLimit(opts.limit)
    const before = opts.cursor ? decodeAuditCursor(opts.cursor).seq : undefined
    // Sequences are zero-padded, so string order is write order.
    const older = this.entries.filter((e) => before === undefined || e.seq < before).reverse()
    const page = older.slice(0, limit)
    const last = page.at(-1)
    return {
      entries: page.map((e) => e.entry),
      nextCursor: older.length > limit && last ? encodeAuditCursor(last.ms, last.seq) : null,
    }
  }
}

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
const endpointId = (integration: string, key: string) => `${integration}\u0000${key}`

export class MemoryCatalogStore implements CatalogStore {
  private integrations = new Map<string, Integration>()
  private endpoints = new Map<string, Endpoint>()

  async getIntegration(key: string): Promise<Integration | null> {
    return this.integrations.get(key) ?? null
  }

  async listIntegrations(): Promise<Integration[]> {
    return [...this.integrations.values()].sort(byKey)
  }

  async putIntegration(i: Integration): Promise<void> {
    this.integrations.set(i.key, i)
  }

  async insertIntegration(i: Integration): Promise<boolean> {
    if (this.integrations.has(i.key)) return false
    this.integrations.set(i.key, i)
    return true
  }

  async deleteIntegration(key: string): Promise<void> {
    for (const [id, e] of this.endpoints) if (e.integration === key) this.endpoints.delete(id)
    this.integrations.delete(key)
  }

  async getEndpoint(integration: string, key: string): Promise<Endpoint | null> {
    return this.endpoints.get(endpointId(integration, key)) ?? null
  }

  async listEndpoints(integration: string): Promise<Endpoint[]> {
    return [...this.endpoints.values()].filter((e) => e.integration === integration).sort(byKey)
  }

  async putEndpoint(e: Endpoint): Promise<void> {
    this.endpoints.set(endpointId(e.integration, e.key), e)
  }

  async insertEndpoint(e: Endpoint): Promise<boolean> {
    if (this.endpoints.has(endpointId(e.integration, e.key))) return false
    this.endpoints.set(endpointId(e.integration, e.key), e)
    return true
  }

  async deleteEndpoint(integration: string, key: string): Promise<void> {
    this.endpoints.delete(endpointId(integration, key))
  }
}
