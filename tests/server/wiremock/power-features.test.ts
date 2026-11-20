import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { NotFoundError, ValidationError } from '../../../src/server/errors'
import { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startWireMock, type WireMockHandle } from '../../helpers/containers'

// Pins the WireMock 3.13.1 behaviour Milestone 2C builds on: scenarios admin API, Matched-Stub-Id,
// webhook serveEventListeners and proxyBaseUrl. The webhook and proxy targets are WireMock's own stub
// port as seen from inside the container (localhost:8080): a second HTTP server WireMock really calls.

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let handle: WireMockHandle
let wm: WireMockClient
let auth: string

beforeAll(async () => {
  handle = await startWireMock()
  wm = new WireMockClient({ baseUrl: handle.url, user: handle.user, password: handle.password })
  auth = `Basic ${Buffer.from(`${handle.user}:${handle.password}`).toString('base64')}`
})
afterAll(async () => {
  await handle?.stop()
})
beforeEach(async () => {
  await handle.restart()
})

const flow = (name: string): StubMapping[] => [
  {
    id: uid(1),
    request: { method: 'GET', urlPath: '/order' },
    response: { status: 200, body: 'pending' },
    scenarioName: name,
    requiredScenarioState: 'Started',
    newScenarioState: 'approved',
  },
  {
    id: uid(2),
    request: { method: 'GET', urlPath: '/order' },
    response: { status: 200, body: 'approved' },
    scenarioName: name,
    requiredScenarioState: 'approved',
  },
]
const body = async (path: string) => (await fetch(`${handle.url}${path}`)).text()

test('scenarios: list shape, the state advances on a call, set and reset', async () => {
  await wm.importStubs(flow('order-flow'), { deleteAllNotInImport: false })
  const [listed] = await wm.listScenarios()
  // possibleStates comes back in no fixed order.
  expect({ ...listed, possibleStates: [...listed.possibleStates].sort() }).toEqual({ name: 'order-flow', state: 'Started', possibleStates: ['Started', 'approved'] })
  expect(await body('/order')).toBe('pending')
  expect(await body('/order')).toBe('approved')
  expect((await wm.listScenarios())[0].state).toBe('approved')

  await wm.setScenarioState('order-flow', 'Started')
  expect(await body('/order')).toBe('pending')
  await wm.resetScenarios()
  expect((await wm.listScenarios())[0].state).toBe('Started')
})

test('scenarios: unknown name is NotFound, unknown state is a ValidationError', async () => {
  await wm.importStubs(flow('order-flow'), { deleteAllNotInImport: false })
  await expect(wm.setScenarioState('nope', 'Started')).rejects.toBeInstanceOf(NotFoundError)
  await expect(wm.setScenarioState('order-flow', 'bogus')).rejects.toBeInstanceOf(ValidationError)
})

test('scenarios: WireMock 3.13.1 does not decode the name in the admin path, so names needing encoding cannot be set', async () => {
  await wm.importStubs(flow('Order Flow'), { deleteAllNotInImport: false })
  const raw = await fetch(`${handle.url}/__admin/scenarios/Order%20Flow/state`, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'Started' }),
  })
  expect(raw.status).toBe(404)
  expect(await raw.text()).toContain('Scenario Order%20Flow does not exist')
  // The client refuses up front instead of sending a request WireMock cannot match.
  await expect(wm.setScenarioState('Order Flow', 'Started')).rejects.toThrow(/can't set the state of a scenario whose name/)
  // Sub-delimiters, ':' and '@' are sent unencoded and work.
  await wm.importStubs(flow("a+b:c@d!e(f)_g.h~i-j;k,l=m*'$&"), { deleteAllNotInImport: false })
  await wm.setScenarioState("a+b:c@d!e(f)_g.h~i-j;k,l=m*'$&", 'approved')
  expect((await wm.listScenarios()).find((s) => s.name.startsWith('a+b'))?.state).toBe('approved')
})

test('Matched-Stub-Id names the stub that served the request', async () => {
  await wm.importStubs([{ id: uid(3), request: { method: 'GET', urlPath: '/m' }, response: { status: 204 } }], { deleteAllNotInImport: false })
  const res = await fetch(`${handle.url}/m`)
  expect(res.headers.get('matched-stub-id')).toBe(uid(3))
  expect((await fetch(`${handle.url}/unmatched`)).headers.get('matched-stub-id')).toBeNull()
})

test('webhook serveEventListener: stored as given and called with templated body after the response', async () => {
  const listener = {
    name: 'webhook',
    parameters: {
      method: 'POST',
      url: 'http://localhost:8080/callback',
      headers: { 'Content-Type': 'application/json', 'X-Hook': 'yes' },
      body: `{"paid":"{{jsonPath originalRequest.body '$.id'}}"}`,
      delay: { type: 'uniform', lower: 10, upper: 50 },
    },
  }
  await wm.importStubs(
    [
      { id: uid(4), request: { method: 'POST', urlPath: '/pay' }, response: { status: 202 }, serveEventListeners: [listener] },
      { id: uid(5), request: { method: 'POST', urlPath: '/callback' }, response: { status: 204 } },
    ],
    { deleteAllNotInImport: false },
  )
  expect((await wm.getStub(uid(4)))?.serveEventListeners).toEqual([listener])
  expect((await fetch(`${handle.url}/pay`, { method: 'POST', body: '{"id":"abc"}' })).status).toBe(202)
  const callback = await waitFor(async () => (await wm.listRequests({ limit: 10 })).find((e) => e.request.url === '/callback'))
  expect(callback.request.body).toBe('{"paid":"abc"}')
  expect(callback.request.headers?.['X-Hook']).toBe('yes')
})

test('proxyBaseUrl forwards with the prefix removed; removeProxyRequestHeaders only matches lower-case names', async () => {
  await wm.importStubs(
    [
      { id: uid(6), request: { method: 'GET', urlPathPattern: '/upstream/.*' }, response: { status: 201, body: 'from upstream', headers: { 'X-Up': 'yes' } } },
      {
        id: uid(7),
        request: { method: 'GET', urlPathPattern: '/lower/.*' },
        response: { proxyBaseUrl: 'http://localhost:8080/upstream', proxyUrlPrefixToRemove: '/lower', additionalProxyRequestHeaders: { 'X-Added': '1' }, removeProxyRequestHeaders: ['x-secret'] },
      },
      {
        id: uid(8),
        request: { method: 'GET', urlPathPattern: '/mixed/.*' },
        response: { proxyBaseUrl: 'http://localhost:8080/upstream', proxyUrlPrefixToRemove: '/mixed', removeProxyRequestHeaders: ['X-Secret'] },
      },
    ],
    { deleteAllNotInImport: false },
  )
  const res = await fetch(`${handle.url}/lower/abc`, { headers: { 'X-Secret': 's' } })
  expect(res.status).toBe(201)
  expect(res.headers.get('x-up')).toBe('yes')
  expect(await res.text()).toBe('from upstream')
  await fetch(`${handle.url}/mixed/def`, { headers: { 'X-Secret': 's' } })
  const upstream = (await wm.listRequests({ limit: 20 })).filter((e) => e.request.url.startsWith('/upstream/'))
  const abc = upstream.find((e) => e.request.url === '/upstream/abc')!
  expect(abc.request.headers?.['X-Added']).toBe('1')
  expect(abc.request.headers?.['X-Secret']).toBeUndefined()
  // The mixed-case name is not removed: MockService lower-cases the list before saving.
  expect(upstream.find((e) => e.request.url === '/upstream/def')!.request.headers?.['X-Secret']).toBe('s')
})

async function waitFor<T>(probe: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const v = await probe()
    if (v !== undefined) return v
    if (Date.now() > until) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 100))
  }
}
