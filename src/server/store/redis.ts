import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { ConflictError } from '../errors'
import type { StubMapping } from '../wiremock/types'
import { createRedis, logErrors } from './connection'
import type { MockStore } from './types'

const HISTORY_MAX = 20
const HISTORY_TTL_SECONDS = 604800

const stubKey = (id: string) => `stub:${id}`
const historyKey = (id: string) => `stub:${id}:history`
const ALL = 'stubs:all'
const byIntegration = (k: string) => `stubs:by-integration:${k}`
const byOwner = (k: string) => `stubs:by-owner:${k}`

const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`

const metaOf = (s: StubMapping | null) => s?.metadata?.wiremockUi
const versionOf = (s: StubMapping | null) => metaOf(s)?.version ?? 0
const parse = (json: string) => JSON.parse(json) as StubMapping

export class RedisMockStore implements MockStore {
  private readonly redis: Redis
  private readonly txConnections = new Set<Redis>()

  private readonly ownsConnection: boolean

  /** Given a connection, the caller owns it and `close()` leaves it open. */
  constructor(redisOrUrl: Redis | string) {
    this.ownsConnection = typeof redisOrUrl === 'string'
    this.redis = typeof redisOrUrl === 'string' ? createRedis(redisOrUrl) : redisOrUrl
  }

  /** WATCH is per connection, so every transaction gets its own short-lived one. */
  private async withTx<T>(fn: (conn: Redis) => Promise<T>): Promise<T> {
    const conn = this.redis.duplicate()
    logErrors(conn)
    this.txConnections.add(conn)
    try {
      return await fn(conn)
    } finally {
      this.txConnections.delete(conn)
      conn.disconnect()
    }
  }

  async get(id: string): Promise<StubMapping | null> {
    const json = await this.redis.get(stubKey(id))
    return json ? parse(json) : null
  }

  private async mget(ids: string[]): Promise<StubMapping[]> {
    if (ids.length === 0) return []
    const out: StubMapping[] = []
    for (const json of await this.redis.mget(ids.map(stubKey))) if (json) out.push(parse(json))
    return out
  }

  async list(filter: { integration?: string; owner?: string } = {}): Promise<StubMapping[]> {
    const keys = [
      filter.integration ? byIntegration(filter.integration) : null,
      filter.owner ? byOwner(filter.owner) : null,
    ].filter((k): k is string => k !== null)
    let ids: string[]
    if (keys.length === 0) ids = await this.redis.smembers(ALL)
    else if (keys.length === 1) ids = await this.redis.smembers(keys[0] as string)
    else ids = await this.redis.sinter(...keys)
    const stubs = await this.mget(ids)
    return stubs.sort((a, b) =>
      (metaOf(b)?.updatedAt ?? '').localeCompare(metaOf(a)?.updatedAt ?? ''),
    )
  }

  listAll(): Promise<StubMapping[]> {
    return this.redis.smembers(ALL).then((ids) => this.mget(ids))
  }

  async save(stub: StubMapping, expectedVersion: number): Promise<void> {
    await this.withTx(async (conn) => {
      await conn.watch(stubKey(stub.id))
      const oldJson = await conn.get(stubKey(stub.id))
      const old = oldJson ? parse(oldJson) : null
      if (versionOf(old) !== expectedVersion || (expectedVersion === 0 && old)) {
        throw new ConflictError()
      }
      const m = conn.multi()
      m.set(stubKey(stub.id), JSON.stringify(stub))
      m.sadd(ALL, stub.id)
      const oldMeta = metaOf(old)
      const newMeta = metaOf(stub)
      if (oldMeta?.integration !== newMeta?.integration) {
        if (oldMeta?.integration) m.srem(byIntegration(oldMeta.integration), stub.id)
      }
      if (newMeta?.integration) m.sadd(byIntegration(newMeta.integration), stub.id)
      if (oldMeta?.owner !== newMeta?.owner) {
        if (oldMeta?.owner) m.srem(byOwner(oldMeta.owner), stub.id)
      }
      if (newMeta?.owner) m.sadd(byOwner(newMeta.owner), stub.id)
      if (oldJson) {
        m.lpush(historyKey(stub.id), oldJson)
        m.ltrim(historyKey(stub.id), 0, HISTORY_MAX - 1)
        m.persist(historyKey(stub.id))
      }
      if ((await m.exec()) === null) throw new ConflictError()
    })
  }

  async delete(id: string, expectedVersion?: number): Promise<void> {
    await this.withTx(async (conn) => {
      await conn.watch(stubKey(id))
      const oldJson = await conn.get(stubKey(id))
      if (!oldJson) return
      const old = parse(oldJson)
      if (expectedVersion !== undefined && versionOf(old) !== expectedVersion) {
        throw new ConflictError()
      }
      const meta = metaOf(old)
      const m = conn.multi()
      m.del(stubKey(id))
      m.srem(ALL, id)
      if (meta?.integration) m.srem(byIntegration(meta.integration), id)
      if (meta?.owner) m.srem(byOwner(meta.owner), id)
      m.lpush(historyKey(id), oldJson)
      m.ltrim(historyKey(id), 0, HISTORY_MAX - 1)
      m.expire(historyKey(id), HISTORY_TTL_SECONDS)
      if ((await m.exec()) === null) throw new ConflictError()
    })
  }

  async history(id: string): Promise<StubMapping[]> {
    return (await this.redis.lrange(historyKey(id), 0, -1)).map(parse)
  }

  async acquireLock(name: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID()
    const res = await this.redis.set(name, token, 'PX', ttlMs, 'NX')
    return res === 'OK' ? token : null
  }

  async releaseLock(name: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, name, token)
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG'
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    for (const c of this.txConnections) c.disconnect()
    this.txConnections.clear()
    if (this.ownsConnection) await this.redis.quit()
  }
}
