import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { createMock, deleteMock, listMocks } from '../../../src/server/http/handlers/mocks'
import { listScenarios, resetScenarios, setScenarioState } from '../../../src/server/http/handlers/scenarios'
import type { Runtime } from '../../../src/server/runtime'
import { STORELESS, basic, login, req as baseReq, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = auth) => baseReq(path, method, body, headers)
const served = async (path: string) => (await fetch(`${env.wm.url}${path}`)).text()

const flowMocks = (scenario: string, path: string) => [
  {
    name: `${scenario} pending`,
    request: { method: 'GET', urlPath: path },
    response: { status: 200, body: 'pending' },
    scenarioName: scenario,
    requiredScenarioState: 'Started',
    newScenarioState: 'approved',
  },
  {
    name: `${scenario} approved`,
    request: { method: 'GET', urlPath: path },
    response: { status: 200, body: 'approved' },
    scenarioName: scenario,
    requiredScenarioState: 'approved',
  },
]

async function createFlow(scenario: string, path: string): Promise<string[]> {
  const ids: string[] = []
  for (const m of flowMocks(scenario, path)) {
    const res = await createMock(rt, req('/api/mocks', 'POST', m))
    expect(res.status).toBe(201)
    ids.push((await res.json()).id)
  }
  return ids
}

const list = async () => {
  const res = await listScenarios(rt, req('/api/scenarios'))
  expect(res.status).toBe(200)
  return (await res.json()) as { scenarios: { name: string; state: string; possibleStates: string[]; settable: boolean; mocks: { id: string; name?: string; requiredState?: string; newState?: string }[] }[] }
}
const setState = (name: string, state: unknown) =>
  setScenarioState(rt, req(`/api/scenarios/${encodeURIComponent(name)}/state`, 'PUT', { state }), { name })

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
}, 120_000)
afterAll(async () => {
  await env?.stop()
})
beforeEach(async () => {
  // Every test starts without scenario mocks.
  for (const m of (await (await listMocks(rt, req('/api/mocks'))).json()) as { id: string; scenarioName?: string }[]) {
    if (m.scenarioName) await deleteMock(rt, req(`/api/mocks/${m.id}`, 'DELETE'), { id: m.id })
  }
})

test('every scenario route needs a signed-in user; writes need the CSRF token with a session', async () => {
  expect((await listScenarios(rt, req('/api/scenarios', 'GET', undefined, {}))).status).toBe(401)
  expect((await setScenarioState(rt, req('/api/scenarios/x/state', 'PUT', { state: 'Started' }, {}), { name: 'x' })).status).toBe(401)
  expect((await resetScenarios(rt, req('/api/scenarios/reset', 'POST', {}, {}))).status).toBe(401)
  const s = await login(rt, 'ui-admin', 'ui-admin-pass')
  expect((await resetScenarios(rt, req('/api/scenarios/reset', 'POST', {}, { Cookie: s.cookie }))).status).toBe(403)
  expect((await resetScenarios(rt, req('/api/scenarios/reset', 'POST', {}, { Cookie: s.cookie, 'X-CSRF-Token': s.csrf }))).status).toBe(204)
})

test('a two-mock pending → approved scenario: listed with its graph and live state, served in order, set and reset', async () => {
  const ids = await createFlow('order-flow', '/sc/order')
  let [sc] = (await list()).scenarios
  expect(sc).toMatchObject({ name: 'order-flow', state: 'Started', possibleStates: ['Started', 'approved'], settable: true })
  expect(sc.mocks).toEqual(
    expect.arrayContaining([
      { id: ids[0], name: 'order-flow pending', requiredState: 'Started', newState: 'approved' },
      { id: ids[1], name: 'order-flow approved', requiredState: 'approved' },
    ]),
  )

  expect(await served('/sc/order')).toBe('pending')
  expect(await served('/sc/order')).toBe('approved')
  expect(await served('/sc/order')).toBe('approved')
  expect((await list()).scenarios[0].state).toBe('approved')

  // Reset one = set Started.
  const reset = await setState('order-flow', 'Started')
  expect(reset.status).toBe(200)
  expect(await reset.json()).toMatchObject({ name: 'order-flow', state: 'Started' })
  expect(await served('/sc/order')).toBe('pending')

  expect((await setState('order-flow', 'approved')).status).toBe(200)
  expect(await served('/sc/order')).toBe('approved')

  const resetOne = await resetScenarios(rt, req('/api/scenarios/reset', 'POST', { name: 'order-flow' }))
  expect(resetOne.status).toBe(204)
  expect((await list()).scenarios[0].state).toBe('Started')
})

test('reset all puts every scenario back to Started', async () => {
  await createFlow('flow-a', '/sc/a')
  await createFlow('flow-b', '/sc/b')
  await served('/sc/a')
  await served('/sc/b')
  expect((await list()).scenarios.map((s) => [s.name, s.state])).toEqual([['flow-a', 'approved'], ['flow-b', 'approved']])
  expect((await resetScenarios(rt, req('/api/scenarios/reset', 'POST', {}))).status).toBe(204)
  expect((await list()).scenarios.map((s) => [s.name, s.state])).toEqual([['flow-a', 'Started'], ['flow-b', 'Started']])
})

test('set state: unknown scenario is 404; a state outside the graph or a bad body is 400', async () => {
  await createFlow('order-flow', '/sc/order')
  const missing = await setState('nope', 'Started')
  expect(missing.status).toBe(404)
  expect((await missing.json()).error).toMatch(/nope/)
  const bad = await setState('order-flow', 'shipped')
  expect(bad.status).toBe(400)
  expect((await bad.json()).error).toBe('state must be one of: Started, approved')
  expect((await setState('order-flow', 42)).status).toBe(400)
  expect((await setState('order-flow', '')).status).toBe(400)
  expect((await resetScenarios(rt, req('/api/scenarios/reset', 'POST', { name: 'nope' }))).status).toBe(404)
})

test('a scenario name WireMock cannot address is listed as not settable and refused with a clear message', async () => {
  await createFlow('Order Flow', '/sc/spaced')
  const [sc] = (await list()).scenarios
  expect(sc).toMatchObject({ name: 'Order Flow', settable: false, state: 'Started' })
  const res = await setState('Order Flow', 'approved')
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(/can't set the state of a scenario whose name/)
  // Reset all still reaches it.
  await served('/sc/spaced')
  expect((await resetScenarios(rt, req('/api/scenarios/reset', 'POST', {}))).status).toBe(204)
  expect(await served('/sc/spaced')).toBe('pending')
})

test.skipIf(STORELESS)('after a WireMock restart the sync brings the scenario mocks back, state Started', async () => {
  await createFlow('order-flow', '/sc/order')
  await served('/sc/order')
  expect((await list()).scenarios[0].state).toBe('approved')
  await env.wm.restart()
  expect(await rt.reconciler!.check()).toBe('synced')
  const [sc] = (await list()).scenarios
  expect(sc).toMatchObject({ name: 'order-flow', state: 'Started' })
  expect(await served('/sc/order')).toBe('pending')
  expect(await served('/sc/order')).toBe('approved')
})
