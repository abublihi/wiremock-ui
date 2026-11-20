import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Endpoint, Integration } from '../../../src/server/catalog/types'
import { drivers, type StoreHarness } from '../../helpers/stores'

const integration = (name: string): Integration => ({
  key: 'pay',
  name,
  prefix: '/pay',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'a',
})

const endpoint = (name: string): Endpoint => ({
  integration: 'pay',
  key: 'get',
  name,
  method: 'GET',
  path: '/x',
  pathType: 'exact',
  contentType: 'json',
  exampleResponses: {},
  allowedStatuses: [200],
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'a',
})

describe.each(drivers)('CatalogStore create-only inserts on %s', (_driver, start) => {
  let h: StoreHarness

  beforeAll(async () => {
    h = await start()
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(async () => {
    await h.probe.reset()
  })

  test('insertIntegration: first true, second false and the stored JSON is unchanged', async () => {
    const store = h.stores.catalog
    expect(await store.insertIntegration(integration('First'))).toBe(true)
    expect(await store.insertIntegration(integration('Second'))).toBe(false)
    expect(await store.getIntegration('pay')).toEqual(integration('First'))
    expect(await store.listIntegrations()).toEqual([integration('First')])
  })

  test('insertEndpoint: first true, second false and the stored JSON is unchanged', async () => {
    const store = h.stores.catalog
    await store.putIntegration(integration('P'))
    expect(await store.insertEndpoint(endpoint('First'))).toBe(true)
    expect(await store.insertEndpoint(endpoint('Second'))).toBe(false)
    expect(await store.getEndpoint('pay', 'get')).toEqual(endpoint('First'))
    expect(await store.listEndpoints('pay')).toEqual([endpoint('First')])
  })

  test('an insert after a delete succeeds again', async () => {
    const store = h.stores.catalog
    await store.insertIntegration(integration('First'))
    await store.deleteIntegration('pay')
    expect(await store.insertIntegration(integration('Again'))).toBe(true)
    expect(await store.getIntegration('pay')).toEqual(integration('Again'))
  })
})
