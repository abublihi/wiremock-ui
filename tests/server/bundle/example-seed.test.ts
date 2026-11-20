import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readBundleFromPath } from '../../../src/server/bundle/parse'
import type { Endpoint } from '../../../src/server/catalog/types'
import { assertValidStub } from '../../../src/server/mocks/service'

// examples/seed.json is what the README and INSTALL tell a new user to start with (SEED_PATH).
test('the example seed is a valid bundle: Blog and Orders, fixed mock ids, endpoints that exist', async () => {
  const { bundle, skipped } = await readBundleFromPath(join(import.meta.dirname, '../../../examples/seed.json'))
  expect(skipped).toEqual([])
  const catalog = bundle.catalog as Endpoint[]
  expect((bundle.integrations as { key: string }[]).map((i) => i.key)).toEqual(['blog', 'orders'])
  expect(catalog.map((e) => `${e.integration}/${e.key}`)).toEqual(['blog/list-posts', 'blog/get-post', 'blog/create-post', 'orders/get-order'])
  const endpoints = new Set(catalog.map((e) => `${e.integration}/${e.key}`))
  for (const mock of bundle.mocks) {
    assertValidStub(mock)
    expect(typeof mock.id, `${mock.name} has a fixed id`).toBe('string')
    const ui = mock.metadata?.wiremockUi
    expect(endpoints.has(`${ui?.integration}/${ui?.endpoint}`), `${mock.name} belongs to a catalog endpoint`).toBe(true)
  }
  const scenario = bundle.mocks.filter((m) => m.scenarioName === 'order-1001')
  expect(scenario.map((m) => [m.requiredScenarioState, m.newScenarioState])).toEqual([
    ['Started', 'shipped'],
    ['shipped', 'delivered'],
    ['delivered', undefined],
  ])
})
