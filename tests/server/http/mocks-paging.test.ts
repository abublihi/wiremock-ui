import { afterAll, beforeAll, expect, test } from 'vitest'
import { listMocks } from '../../../src/server/http/handlers/mocks'
import type { Runtime } from '../../../src/server/runtime'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { basic, req as baseReq, startTestRuntime } from '../../helpers/http'

// Runs on every driver (redis, sqlite, none): paging happens after the store's list, so all three must agree.
let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime

const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const get = async (path: string) => {
  const res = await listMocks(rt, baseReq(path, 'GET', undefined, auth))
  return { status: res.status, body: await res.json() }
}

const TOTAL = 1000
const SCENARIOS = 5
const STEPS = 3

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  const actor = { id: 'ui-admin', username: 'ui-admin', displayName: 'ui-admin', disabled: false, createdAt: '', updatedAt: '' }
  // Scenario steps are spread out in time so that, sorted newest first, other mocks sit between them.
  for (let i = 0; i < TOTAL; i++) {
    const scenario = i % 200 < STEPS * 20 && i % 20 === 0 ? Math.floor(i / 200) : undefined
    await rt.mocks.create(
      {
        name: `paged ${i}`,
        request: { method: 'GET', urlPath: `/paging/${i}` },
        response: { status: i % 2 ? 200 : 404 },
        metadata: { wiremockUi: { integration: 'paging' } },
        ...(scenario !== undefined && scenario < SCENARIOS ? { scenarioName: `flow ${scenario}`, requiredScenarioState: 'Started' } : {}),
      },
      actor,
    )
  }
}, 600_000)

afterAll(async () => {
  await env?.stop()
})

test('without limit the list is a plain array, as before', async () => {
  const { status, body } = await get('/api/mocks?integration=paging')
  expect(status).toBe(200)
  expect(Array.isArray(body)).toBe(true)
  expect(body).toHaveLength(TOTAL)
})

test('limit and offset page the rows; a scenario counts as one row and is never split', async () => {
  const first = await get('/api/mocks?integration=paging&limit=50')
  expect(first.status).toBe(200)
  // 5 scenarios × 3 mocks are 5 rows.
  expect(first.body).toMatchObject({ total: TOTAL - SCENARIOS * (STEPS - 1), totalMocks: TOTAL, offset: 0, limit: 50 })
  const seen: StubMapping[] = []
  for (let offset = 0; offset < first.body.total; offset += 50) {
    const page = await get(`/api/mocks?integration=paging&limit=50&offset=${offset}`)
    expect(page.body.total).toBe(first.body.total)
    const items = page.body.items as StubMapping[]
    seen.push(...items)
    // Every scenario on this page has all its steps here.
    for (const name of new Set(items.map((s) => s.scenarioName).filter(Boolean))) {
      expect(items.filter((s) => s.scenarioName === name)).toHaveLength(STEPS)
    }
  }
  expect(seen).toHaveLength(TOTAL)
  expect(new Set(seen.map((s) => s.id)).size).toBe(TOTAL)
  const past = await get(`/api/mocks?integration=paging&limit=50&offset=${first.body.total}`)
  expect(past.body.items).toEqual([])
})

test('filters apply before paging', async () => {
  const page = await get('/api/mocks?integration=paging&status=404&limit=10&offset=0')
  expect(page.body.totalMocks).toBe(TOTAL / 2)
  expect((page.body.items as StubMapping[]).every((s) => s.response.status === 404)).toBe(true)
  const scenarios = await get('/api/mocks?integration=paging&scenario=*&limit=2')
  expect(scenarios.body).toMatchObject({ total: SCENARIOS, totalMocks: SCENARIOS * STEPS })
  expect(scenarios.body.items).toHaveLength(2 * STEPS)
})

test('bad limit or offset is a 400 naming the rule', async () => {
  for (const q of ['limit=0', 'limit=201', 'limit=abc', 'limit=1.5', 'limit=']) {
    const res = await get(`/api/mocks?${q}`)
    expect(res.status, q).toBe(400)
    expect(res.body).toEqual({ error: 'limit must be an integer between 1 and 200' })
  }
  for (const q of ['limit=5&offset=-1', 'limit=5&offset=x']) {
    const res = await get(`/api/mocks?${q}`)
    expect(res.status, q).toBe(400)
    expect(res.body).toEqual({ error: 'offset must be a non-negative integer' })
  }
  const alone = await get('/api/mocks?offset=10')
  expect(alone.status).toBe(400)
  expect(alone.body).toEqual({ error: 'offset needs limit' })
})
