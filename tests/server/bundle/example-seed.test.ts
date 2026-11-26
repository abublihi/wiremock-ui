import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readBundleFromPath } from '../../../src/server/bundle/parse'
import { assertGroupMeta, type GroupMeta } from '../../../src/server/mocks/groups'
import { assertValidStub } from '../../../src/server/mocks/service'

// examples/seed.json is what the README and INSTALL tell a new user to start with (SEED_PATH).
test('the example seed is a valid bundle: tagged Blog and Orders mocks, fixed ids, one mock with several responses', async () => {
  const { bundle, skipped } = await readBundleFromPath(join(import.meta.dirname, '../../../examples/seed.json'))
  expect(skipped).toEqual([])
  expect(bundle.integrations).toEqual([])
  expect(bundle.catalog).toEqual([])
  for (const mock of bundle.mocks) {
    assertValidStub(mock)
    expect(typeof mock.id, `${mock.name} has a fixed id`).toBe('string')
    const ui = mock.metadata?.wiremockUi as { tags?: string[]; group?: unknown } | undefined
    expect(ui?.tags?.length, `${mock.name} has a tag`).toBe(1)
    if (ui?.group !== undefined) assertGroupMeta(ui.group)
  }
  expect([...new Set(bundle.mocks.map((m) => (m.metadata?.wiremockUi as { tags: string[] }).tags[0]))]).toEqual(['blog', 'orders'])

  const getPost = bundle.mocks.filter((m) => (m.metadata?.wiremockUi as { group?: GroupMeta }).group?.id === 'endpoint-blog-get-post')
  // In the older one-condition shape (still read): a value per response, the fallback without one.
  expect(getPost.map((m) => (m.metadata?.wiremockUi as unknown as { group: { value?: string } }).group.value)).toEqual(['42', '43', undefined])

  const scenario = bundle.mocks.filter((m) => m.scenarioName === 'order-1001')
  expect(scenario.map((m) => [m.requiredScenarioState, m.newScenarioState])).toEqual([
    ['Started', 'shipped'],
    ['shipped', 'delivered'],
    ['delivered', undefined],
  ])
})
