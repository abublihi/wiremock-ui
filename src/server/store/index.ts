import type { Config } from '../config'
import { RedisMockStore } from './redis'
import type { MockStore } from './types'

export type { MockStore } from './types'
export { RedisMockStore } from './redis'

export function createStore(config: Config): MockStore {
  return new RedisMockStore(config.redisUrl)
}
