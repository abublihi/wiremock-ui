import type { Redis } from 'ioredis'
import type { CatalogStore, Endpoint, Integration } from './types'

const integrationKey = (key: string) => `integration:${key}`
const ALL = 'integrations:all'
const endpointKey = (integration: string, key: string) => `catalog:${integration}:${key}`
const endpointSet = (integration: string) => `catalog:${integration}`

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

export class RedisCatalogStore implements CatalogStore {
  constructor(private readonly redis: Redis) {}

  async getIntegration(key: string): Promise<Integration | null> {
    const json = await this.redis.get(integrationKey(key))
    return json ? (JSON.parse(json) as Integration) : null
  }

  async listIntegrations(): Promise<Integration[]> {
    const keys = await this.redis.smembers(ALL)
    if (keys.length === 0) return []
    const jsons = await this.redis.mget(keys.map(integrationKey))
    return jsons
      .filter((j): j is string => j !== null)
      .map((j) => JSON.parse(j) as Integration)
      .sort(byKey)
  }

  async putIntegration(i: Integration): Promise<void> {
    const m = this.redis.multi()
    m.set(integrationKey(i.key), JSON.stringify(i))
    m.sadd(ALL, i.key)
    await m.exec()
  }

  async deleteIntegration(key: string): Promise<void> {
    const endpoints = await this.redis.smembers(endpointSet(key))
    const m = this.redis.multi()
    for (const e of endpoints) m.del(endpointKey(key, e))
    m.del(endpointSet(key))
    m.del(integrationKey(key))
    m.srem(ALL, key)
    await m.exec()
  }

  async getEndpoint(integration: string, key: string): Promise<Endpoint | null> {
    const json = await this.redis.get(endpointKey(integration, key))
    return json ? (JSON.parse(json) as Endpoint) : null
  }

  async listEndpoints(integration: string): Promise<Endpoint[]> {
    const keys = await this.redis.smembers(endpointSet(integration))
    if (keys.length === 0) return []
    const jsons = await this.redis.mget(keys.map((k) => endpointKey(integration, k)))
    return jsons
      .filter((j): j is string => j !== null)
      .map((j) => JSON.parse(j) as Endpoint)
      .sort(byKey)
  }

  async putEndpoint(e: Endpoint): Promise<void> {
    const m = this.redis.multi()
    m.set(endpointKey(e.integration, e.key), JSON.stringify(e))
    m.sadd(endpointSet(e.integration), e.key)
    await m.exec()
  }

  async deleteEndpoint(integration: string, key: string): Promise<void> {
    const m = this.redis.multi()
    m.del(endpointKey(integration, key))
    m.srem(endpointSet(integration), key)
    await m.exec()
  }
}
