import type { Config } from '../config'
import { type AuditLog, RedisAuditLog } from '../audit/log'
import { RedisCatalogStore } from '../catalog/store'
import type { CatalogStore } from '../catalog/types'
import { ConfigError } from '../errors'
import { RedisUserStore } from '../users/store'
import type { UserStore } from '../users/types'
import { createRedis } from './connection'
import { RedisMockStore } from './redis'
import { SqliteAuditLog } from './sqlite/audit'
import { SqliteCatalogStore } from './sqlite/catalog'
import { SqliteDb } from './sqlite/db'
import { SqliteMockStore } from './sqlite/mocks'
import { SqliteUserStore } from './sqlite/users'
import type { MockStore } from './types'

export type { MockStore } from './types'
export { RedisMockStore } from './redis'

export type Stores = {
  mocks: MockStore
  users: UserStore
  audit: AuditLog
  catalog: CatalogStore
  ping(): Promise<boolean>
  close(): Promise<void>
}

/** Builds every store on the configured driver (spec A9); `close()` releases the shared connection once. */
export function createStores(config: Config): Stores {
  return config.storeDriver === 'sqlite' ? createSqliteStores(config.sqlitePath) : createRedisStores(config.redisUrl)
}

function createRedisStores(url: string | undefined): Stores {
  if (!url) throw new ConfigError('REDIS_URL is required when STORE_DRIVER=redis')
  const redis = createRedis(url)
  const mocks = new RedisMockStore(redis)
  return {
    mocks,
    users: new RedisUserStore(redis),
    audit: new RedisAuditLog(redis),
    catalog: new RedisCatalogStore(redis),
    ping: () => mocks.ping(),
    async close() {
      await mocks.close()
      await redis.quit()
    },
  }
}

function createSqliteStores(path: string): Stores {
  let sql: SqliteDb
  try {
    sql = new SqliteDb(path)
  } catch (err) {
    // A path that cannot be opened will not fix itself: fail boot at once instead of retrying.
    throw new ConfigError(`Cannot open SQLITE_PATH ${path}: ${(err as Error).message}`)
  }
  return {
    mocks: new SqliteMockStore(sql),
    users: new SqliteUserStore(sql),
    audit: new SqliteAuditLog(sql),
    catalog: new SqliteCatalogStore(sql),
    ping: async () => sql.ping(),
    close: async () => sql.close(),
  }
}
