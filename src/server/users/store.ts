import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'
import { ConflictError } from '../errors'
import type { Session, User, UserStore } from './types'

const userKey = (id: string) => `user:${id}`
const nameKey = (username: string) => `users:by-name:${username.toLowerCase()}`
const sessionKey = (id: string) => `session:${id}`
const userSessionsKey = (id: string) => `user:${id}:sessions`
const rateKey = (ip: string) => `ratelimit:login:${ip}`
const ALL = 'users:all'

const token = () => randomBytes(32).toString('base64url')

// KEYS: user, by-name. ARGV: id, json. Returns 0 when the name is taken.
const CREATE_LUA = `
if redis.call("set", KEYS[2], ARGV[1], "NX") == false then return 0 end
redis.call("set", KEYS[1], ARGV[2])
redis.call("sadd", "${ALL}", ARGV[1])
return 1`

// KEYS: user, new by-name, old by-name. ARGV: id, json. Returns 0 when the new name belongs to someone else.
const UPDATE_LUA = `
if KEYS[2] ~= KEYS[3] then
  if redis.call("set", KEYS[2], ARGV[1], "NX") == false then return 0 end
  redis.call("del", KEYS[3])
end
redis.call("set", KEYS[1], ARGV[2])
return 1`

const HIT_LUA = `
local n = redis.call("incr", KEYS[1])
if n == 1 then redis.call("expire", KEYS[1], ARGV[1]) end
return n`

export class RedisUserStore implements UserStore {
  constructor(private readonly redis: Redis) {}

  async getUser(id: string): Promise<User | null> {
    const json = await this.redis.get(userKey(id))
    return json ? (JSON.parse(json) as User) : null
  }

  async getUserByName(username: string): Promise<User | null> {
    const id = await this.redis.get(nameKey(username))
    return id ? this.getUser(id) : null
  }

  async listUsers(): Promise<User[]> {
    const ids = await this.redis.smembers(ALL)
    if (ids.length === 0) return []
    const jsons = await this.redis.mget(ids.map(userKey))
    return jsons
      .filter((j): j is string => j !== null)
      .map((j) => JSON.parse(j) as User)
      .sort((a, b) => a.username.localeCompare(b.username, 'en', { sensitivity: 'base' }))
  }

  async createUser(user: User): Promise<void> {
    const ok = await this.redis.eval(CREATE_LUA, 2, userKey(user.id), nameKey(user.username), user.id, JSON.stringify(user))
    if (ok === 0) throw new ConflictError('Username already exists')
  }

  async updateUser(user: User): Promise<void> {
    const old = await this.getUser(user.id)
    const oldKey = old ? nameKey(old.username) : nameKey(user.username)
    const ok = await this.redis.eval(
      UPDATE_LUA,
      3,
      userKey(user.id),
      nameKey(user.username),
      oldKey,
      user.id,
      JSON.stringify(user),
    )
    if (ok === 0) throw new ConflictError('Username already exists')
    await this.redis.sadd(ALL, user.id)
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.getUser(id)
    await this.deleteSessionsOf(id)
    const m = this.redis.multi()
    m.del(userKey(id))
    m.srem(ALL, id)
    if (user) m.del(nameKey(user.username))
    await m.exec()
  }

  countUsers(): Promise<number> {
    return this.redis.scard(ALL)
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
    const m = this.redis.multi()
    m.set(sessionKey(session.id), JSON.stringify(session), 'EX', ttlSeconds)
    m.sadd(userSessionsKey(userId), session.id)
    m.expire(userSessionsKey(userId), ttlSeconds)
    await m.exec()
    return session
  }

  async getSession(id: string): Promise<Session | null> {
    const json = await this.redis.get(sessionKey(id))
    return json ? (JSON.parse(json) as Session) : null
  }

  async deleteSession(id: string): Promise<void> {
    const session = await this.getSession(id)
    const m = this.redis.multi()
    m.del(sessionKey(id))
    if (session) m.srem(userSessionsKey(session.userId), id)
    await m.exec()
  }

  async deleteSessionsOf(userId: string): Promise<void> {
    const ids = await this.redis.smembers(userSessionsKey(userId))
    const m = this.redis.multi()
    for (const id of ids) m.del(sessionKey(id))
    m.del(userSessionsKey(userId))
    await m.exec()
  }

  async hitRateLimit(ip: string, windowSeconds: number): Promise<number> {
    return (await this.redis.eval(HIT_LUA, 1, rateKey(ip), windowSeconds)) as number
  }
}
