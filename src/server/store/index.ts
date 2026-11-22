import type { StoreSettings } from '../config'
import { type AuditLog, RedisAuditLog } from '../audit/log'
import { RedisCatalogStore } from '../catalog/store'
import type { CatalogStore } from '../catalog/types'
import { ConfigError } from '../errors'
import { RedisUserStore } from '../users/store'
import type { UserStore } from '../users/types'
import type { WireMockClient } from '../wiremock/client'
import { createRedis } from './connection'
import { MemoryAuditLog, MemoryCatalogStore, MemoryUserStore } from './memory'
import { RedisMockStore } from './redis'
import { SqliteAuditLog } from './sqlite/audit'
import { SqliteCatalogStore } from './sqlite/catalog'
import { SqliteDb } from './sqlite/db'
import { SqliteMockStore } from './sqlite/mocks'
import { SqliteUserStore } from './sqlite/users'
import type { MockStore } from './types'
import { MemoryRecordingStore, RedisRecordingStore, SqliteRecordingStore } from '../recording/store'
import type { RecordingStore } from '../recording/types'
import { WireMockMockStore } from './wiremock'

export type { MockStore } from './types'
export { RedisMockStore } from './redis'

export type Stores = {
  mocks: MockStore
  users: UserStore
  audit: AuditLog
  catalog: CatalogStore
  /** Review lists from recordings and snapshots (spec A12). */
  recordings: RecordingStore
  ping(): Promise<boolean>
  close(): Promise<void>
}

/**
 * Builds every store on the configured driver (spec A9); `close()` releases the shared connection once.
 * `none` (spec A10) needs `wiremock`: its mock store is WireMock itself.
 */
export function createStores(config: StoreSettings, opts: { wiremock?: WireMockClient } = {}): Stores {
  if (config.storeDriver === 'none') {
    if (!opts.wiremock) throw new ConfigError('STORE_DRIVER=none needs a WireMock client')
    return createWireMockOnlyStores(opts.wiremock)
  }
  return config.storeDriver === 'sqlite' ? createSqliteStores(config.sqlitePath) : createRedisStores(config.redisUrl)
}

/** WireMock-only mode: mocks live in WireMock; accounts, sessions, audit and catalog in memory (lost on restart). */
function createWireMockOnlyStores(wiremock: WireMockClient): Stores {
  const mocks = new WireMockMockStore(wiremock)
  return {
    mocks,
    users: new MemoryUserStore(),
    audit: new MemoryAuditLog(),
    catalog: new MemoryCatalogStore(),
    recordings: new MemoryRecordingStore(),
    ping: () => mocks.ping(),
    close: async () => {},
  }
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
    recordings: new RedisRecordingStore(redis),
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
    recordings: new SqliteRecordingStore(sql),
    ping: async () => sql.ping(),
    close: async () => sql.close(),
  }
}
