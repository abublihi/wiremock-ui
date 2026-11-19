import type { Config } from '../config'
import { type AuditLog, RedisAuditLog } from '../audit/log'
import { RedisCatalogStore } from '../catalog/store'
import type { CatalogStore } from '../catalog/types'
import { RedisUserStore } from '../users/store'
import type { UserStore } from '../users/types'
import { createRedis } from './connection'
import { RedisMockStore } from './redis'
import type { MockStore } from './types'

export type { MockStore } from './types'
export { RedisMockStore } from './redis'

export function createStore(config: Config): MockStore {
  return new RedisMockStore(config.redisUrl)
}

export type Stores = {
  mocks: MockStore
  users: UserStore
  audit: AuditLog
  catalog: CatalogStore
  ping(): Promise<boolean>
  close(): Promise<void>
}

/** Builds every store on one shared Redis connection; `close()` quits it once. */
export function createStores(config: Config): Stores {
  const redis = createRedis(config.redisUrl)
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
