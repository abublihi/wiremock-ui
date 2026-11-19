import { randomBytes } from 'node:crypto'
import { ConflictError, NotFoundError } from '../../errors'
import type { Session, User, UserStore } from '../../users/types'
import type { SqliteDb } from './db'

const token = () => randomBytes(32).toString('base64url')

type JsonRow = { json: string }

export class SqliteUserStore implements UserStore {
  constructor(private readonly sql: SqliteDb) {}

  async getUser(id: string): Promise<User | null> {
    const row = this.sql.stmt('SELECT json FROM users WHERE id = ?').get(id) as JsonRow | undefined
    return row ? (JSON.parse(row.json) as User) : null
  }

  async getUserByName(username: string): Promise<User | null> {
    const row = this.sql.stmt('SELECT json FROM users WHERE username_lower = ?').get(username.toLowerCase()) as
      | JsonRow
      | undefined
    return row ? (JSON.parse(row.json) as User) : null
  }

  async listUsers(): Promise<User[]> {
    return (this.sql.stmt('SELECT json FROM users').all() as JsonRow[])
      .map((r) => JSON.parse(r.json) as User)
      .sort((a, b) => a.username.localeCompare(b.username, 'en', { sensitivity: 'base' }))
  }

  async createUser(user: User): Promise<void> {
    this.sql.tx(() => {
      const holder = this.sql.stmt('SELECT id FROM users WHERE username_lower = ?').get(user.username.toLowerCase())
      if (holder) throw new ConflictError('Username already exists')
      this.sql
        .stmt(
          `INSERT INTO users (id, username_lower, json) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET username_lower = excluded.username_lower, json = excluded.json`,
        )
        .run(user.id, user.username.toLowerCase(), JSON.stringify(user))
    })
  }

  async updateUser(user: User): Promise<void> {
    this.sql.tx(() => {
      if (!this.sql.stmt('SELECT 1 FROM users WHERE id = ?').get(user.id)) throw new NotFoundError('User not found')
      const holder = this.sql.stmt('SELECT id FROM users WHERE username_lower = ?').get(user.username.toLowerCase()) as
        | { id: string }
        | undefined
      if (holder && holder.id !== user.id) throw new ConflictError('Username already exists')
      this.sql
        .stmt('UPDATE users SET username_lower = ?, json = ? WHERE id = ?')
        .run(user.username.toLowerCase(), JSON.stringify(user), user.id)
    })
  }

  async deleteUser(id: string): Promise<void> {
    this.sql.tx(() => {
      this.sql.stmt('DELETE FROM sessions WHERE user_id = ?').run(id)
      this.sql.stmt('DELETE FROM users WHERE id = ?').run(id)
    })
  }

  async countUsers(): Promise<number> {
    return (this.sql.stmt('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  }

  async createSession(userId: string, ttlSeconds: number): Promise<Session> {
    const now = Date.now()
    const session: Session = {
      id: token(),
      userId,
      csrfToken: token(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    }
    this.sql.tx(() => {
      this.sql.stmt('DELETE FROM sessions WHERE expires_at <= ?').run(now)
      this.sql
        .stmt('INSERT INTO sessions (id, user_id, json, expires_at) VALUES (?, ?, ?, ?)')
        .run(session.id, userId, JSON.stringify(session), now + ttlSeconds * 1000)
    })
    return session
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.sql.stmt('SELECT json FROM sessions WHERE id = ? AND expires_at > ?').get(id, Date.now()) as
      | JsonRow
      | undefined
    return row ? (JSON.parse(row.json) as Session) : null
  }

  async deleteSession(id: string): Promise<void> {
    this.sql.stmt('DELETE FROM sessions WHERE id = ?').run(id)
  }

  async deleteSessionsOf(userId: string): Promise<void> {
    this.sql.stmt('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }

  async deleteOtherSessions(userId: string, keepId: string): Promise<void> {
    this.sql.stmt('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, keepId)
  }

  async hitRateLimit(ip: string, windowSeconds: number): Promise<number> {
    return this.sql.tx(() => {
      const now = Date.now()
      this.sql.stmt('DELETE FROM login_rate_limits WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now)
      // Like the Redis INCR + EXPIRE-when-no-TTL: the window starts at the first hit and a counter
      // without a window (restored or manually written) gets one, so it can never block forever.
      const row = this.sql
        .stmt(
          `INSERT INTO login_rate_limits (ip, count, expires_at) VALUES (?, 1, ?)
           ON CONFLICT (ip) DO UPDATE SET count = count + 1, expires_at = COALESCE(expires_at, excluded.expires_at)
           RETURNING count`,
        )
        .get(ip, now + windowSeconds * 1000) as { count: number }
      return row.count
    })
  }

  async releaseRateLimit(ip: string): Promise<void> {
    this.sql
      .stmt('UPDATE login_rate_limits SET count = count - 1 WHERE ip = ? AND count > 0 AND (expires_at IS NULL OR expires_at > ?)')
      .run(ip, Date.now())
  }
}
