import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { RedisAuditLog } from '../../../src/server/audit/log'
import { CatalogService } from '../../../src/server/catalog/service'
import { RedisCatalogStore } from '../../../src/server/catalog/store'
import { createRedis } from '../../../src/server/store/connection'
import type { MockStore } from '../../../src/server/store/types'
import { startRedis } from '../../helpers/containers'

let handle: Awaited<ReturnType<typeof startRedis>>
let redis: Redis
let audit: RedisAuditLog
let svc: CatalogService
let mockCount = 0
const mocks = { list: async () => Array.from({ length: mockCount }) } as unknown as MockStore

beforeAll(async () => {
  handle = await startRedis()
  redis = createRedis(handle.url)
  audit = new RedisAuditLog(redis)
  svc = new CatalogService({ catalog: new RedisCatalogStore(redis), audit, mocks, now: () => new Date('2026-01-02T03:04:05.000Z') })
})
afterAll(async () => {
  await redis.quit()
  await handle.stop()
})
beforeEach(async () => {
  await redis.flushdb()
  mockCount = 0
})

const integration = (extra: Record<string, unknown> = {}) => ({ key: 'payments', name: 'Payments', prefix: '/pay', ...extra })
const endpoint = (extra: Record<string, unknown> = {}) => ({
  integration: 'payments',
  key: 'get-user',
  name: 'Get user',
  method: 'GET',
  path: '/users/{id}',
  pathType: 'template',
  lookup: { location: 'path', expression: 'id' },
  contentType: 'json',
  exampleResponses: { '200': '{"ok":true}' },
  allowedStatuses: [200, 404],
  ...extra,
})

describe('integration validation', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['uppercase key', { key: 'Pay' }, 'key'],
    ['key starting with dash', { key: '-pay' }, 'key'],
    ['key too long', { key: 'a'.repeat(64) }, 'key'],
    ['prefix without slash', { prefix: 'pay' }, 'prefix must start with /'],
    ['prefix with trailing slash', { prefix: '/pay/' }, 'prefix must not end with /'],
    ['prefix with query', { prefix: '/pay?x=1' }, 'prefix must not contain ? or #'],
    ['prefix with hash', { prefix: '/pay#x' }, 'prefix must not contain ? or #'],
    ['missing name', { name: undefined }, 'name'],
  ]
  test.each(cases)('%s → 400', async (_n, patch, message) => {
    await expect(svc.upsertIntegration(integration(patch), 'a')).rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) })
  })
  test('prefix "/" alone is allowed', async () => {
    await expect(svc.upsertIntegration(integration({ prefix: '/' }), 'a')).resolves.toMatchObject({ prefix: '/' })
  })
})

describe('endpoint validation', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['bad key', { key: 'Get_User' }, 'key'],
    ['path without slash', { path: 'users/{id}' }, 'path must start with /'],
    ['invalid regex', { path: '/(', pathType: 'regex', lookup: undefined }, 'regular expression'],
    ['path lookup on exact path', { pathType: 'exact', path: '/users/1' }, 'requires pathType template'],
    ['path lookup naming no segment', { lookup: { location: 'path', expression: 'nope' } }, '{name} segment'],
    ['jsonPath not starting with $', { lookup: { location: 'jsonPath', expression: 'a.b' } }, 'jsonPath must start with $'],
    ['xPath not starting with /', { lookup: { location: 'xPath', expression: 'a/b' } }, 'xPath must start with /'],
    ['status below 100', { allowedStatuses: [99] }, 'allowedStatuses'],
    ['status above 599', { allowedStatuses: [600] }, 'allowedStatuses'],
    ['non 3-digit response key', { exampleResponses: { ok: '{}' } }, 'exampleResponses key "ok"'],
    ['json response not parseable', { exampleResponses: { '200': '{nope' } }, 'exampleResponses.200 must be valid JSON'],
    ['json request not parseable', { exampleRequest: 'x' }, 'exampleRequest must be valid JSON'],
    ['unknown method', { method: 'FETCH' }, 'method'],
    ['unknown contentType', { contentType: 'yaml' }, 'contentType'],
    ['javascript: link', { links: [{ label: 'ok', url: 'https://a.test' }, { label: 'x', url: 'javascript:alert(1)' }] }, 'links.1.url must be an http(s) URL'],
    ['relative link', { links: [{ label: 'x', url: '/docs' }] }, 'links.0.url must be an http(s) URL'],
  ]
  beforeEach(async () => {
    await svc.upsertIntegration(integration(), 'a')
  })
  test.each(cases)('%s → 400', async (_n, patch, message) => {
    await expect(svc.upsertEndpoint(endpoint(patch), 'a')).rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) })
  })
  test('empty json examples and non-json text examples are accepted', async () => {
    await svc.upsertEndpoint(endpoint({ exampleRequest: '', exampleResponses: { '204': '' } }), 'a')
    await svc.upsertEndpoint(endpoint({ key: 'txt', contentType: 'text', exampleRequest: 'plain', exampleResponses: { '200': 'not json' } }), 'a')
  })
  test('http and https links are accepted', async () => {
    await svc.upsertEndpoint(endpoint({ links: [{ label: 'a', url: 'http://a.test/x' }, { label: 'b', url: 'https://b.test' }] }), 'a')
  })
  test('endpoint under an unknown integration → 404', async () => {
    await expect(svc.upsertEndpoint(endpoint({ integration: 'ghost' }), 'a')).rejects.toMatchObject({ status: 404 })
    await expect(svc.listEndpoints('ghost')).rejects.toMatchObject({ status: 404 })
  })
})

test('upsert then list: sorted by key, server sets updatedAt/updatedBy', async () => {
  await svc.upsertIntegration(integration({ key: 'zeta', name: 'Z' }), 'dev')
  const stored = await svc.upsertIntegration(integration(), 'dev')
  expect(stored).toMatchObject({ updatedAt: '2026-01-02T03:04:05.000Z', updatedBy: 'dev' })
  expect((await svc.listIntegrations()).map((i) => i.key)).toEqual(['payments', 'zeta'])
  await svc.upsertEndpoint(endpoint({ key: 'b' }), 'dev')
  await svc.upsertEndpoint(endpoint({ key: 'a' }), 'dev')
  expect((await svc.listEndpoints('payments')).map((e) => e.key)).toEqual(['a', 'b'])
  expect(await svc.getEndpoint('payments', 'a')).toMatchObject({ name: 'Get user', updatedBy: 'dev' })
  await svc.upsertIntegration(integration({ name: 'Renamed' }), 'dev')
  expect((await svc.getIntegration('payments')).name).toBe('Renamed')
})

test('deleting an integration removes its endpoints and keys', async () => {
  await svc.upsertIntegration(integration(), 'a')
  await svc.upsertEndpoint(endpoint(), 'a')
  await svc.deleteIntegration('payments', 'a')
  await expect(svc.getIntegration('payments')).rejects.toMatchObject({ status: 404 })
  expect(await svc.listIntegrations()).toEqual([])
  expect(await redis.keys('*catalog*')).toEqual([])
  expect(await redis.keys('integration*')).toEqual([])
  await svc.upsertIntegration(integration(), 'a')
  expect(await svc.listEndpoints('payments')).toEqual([])
})

test('deleting an integration with mocks → 409 and nothing removed', async () => {
  await svc.upsertIntegration(integration(), 'a')
  await svc.upsertEndpoint(endpoint(), 'a')
  mockCount = 1
  await expect(svc.deleteIntegration('payments', 'a')).rejects.toMatchObject({ status: 409, message: 'Integration still has mocks' })
  expect(await svc.listEndpoints('payments')).toHaveLength(1)
})

test('deleteEndpoint removes one; unknown → 404', async () => {
  await svc.upsertIntegration(integration(), 'a')
  await svc.upsertEndpoint(endpoint(), 'a')
  await svc.deleteEndpoint('payments', 'get-user', 'a')
  expect(await svc.listEndpoints('payments')).toEqual([])
  await expect(svc.deleteEndpoint('payments', 'get-user', 'a')).rejects.toMatchObject({ status: 404 })
  await expect(svc.deleteIntegration('ghost', 'a')).rejects.toMatchObject({ status: 404 })
})

test('audit entries for each mutation', async () => {
  await svc.upsertIntegration(integration(), 'dev')
  await svc.upsertEndpoint(endpoint(), 'dev')
  await svc.deleteEndpoint('payments', 'get-user', 'dev')
  await svc.deleteIntegration('payments', 'admin')
  const entries = (await audit.list()).entries.reverse().map((e) => [e.actor, e.action, e.target])
  expect(entries).toEqual([
    ['dev', 'catalog.integration.upsert', 'payments'],
    ['dev', 'catalog.endpoint.upsert', 'payments/get-user'],
    ['dev', 'catalog.endpoint.delete', 'payments/get-user'],
    ['admin', 'catalog.integration.delete', 'payments'],
  ])
})
