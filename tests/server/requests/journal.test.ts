import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { NotFoundError } from '../../../src/server/errors'
import type { Runtime } from '../../../src/server/runtime'
import { startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
const hit = (path: string, init?: RequestInit) => fetch(`${env.wm.url}${path}`, init)

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  await rt.catalog.upsertIntegration({ key: 'pay', name: 'Payments', prefix: '/pay' }, 'ui-admin')
  await rt.catalog.upsertIntegration({ key: 'payv2', name: 'Payments v2', prefix: '/pay/v2' }, 'ui-admin')
  await rt.mocks.create(
    { request: { method: 'POST', urlPath: '/pay/charge' }, response: { status: 201, body: 'charged' }, name: 'charge' } as never,
    (await rt.users.list()).find((u) => u.username === 'ui-admin')!,
  )
}, 120_000)
afterAll(async () => {
  await env?.stop()
})
beforeEach(() => rt.requests.clear('ui-admin'))

async function traffic() {
  await hit('/pay/charge', { method: 'POST', body: 'amount=Bananas' })
  await hit('/pay/v2/other')
  await hit('/payments/x')
}

test('list maps matched and unmatched requests, newest first', async () => {
  await traffic()
  const rows = await rt.requests.list({})
  expect(rows.map((r) => r.url)).toEqual(['/payments/x', '/pay/v2/other', '/pay/charge'])
  const [pays, v2, charge] = rows
  expect(charge).toMatchObject({ method: 'POST', status: 201, matched: true, stubName: 'charge', integration: 'pay' })
  expect(charge.stubId).toMatch(/^[0-9a-f-]{36}$/)
  expect(charge.durationMs).toEqual(expect.any(Number))
  expect(Number.isNaN(Date.parse(charge.loggedAt))).toBe(false)
  expect(v2).toMatchObject({ status: 404, matched: false, stubId: null, stubName: null, integration: 'payv2' })
  // path-boundary rule: /payments does not belong to /pay
  expect(pays.integration).toBeNull()
})

test('filters narrow the list', async () => {
  await traffic()
  expect((await rt.requests.list({ matched: true })).map((r) => r.url)).toEqual(['/pay/charge'])
  expect(await rt.requests.list({ matched: false })).toHaveLength(2)
  expect((await rt.requests.list({ integration: 'payv2' })).map((r) => r.url)).toEqual(['/pay/v2/other'])
  expect((await rt.requests.list({ status: 201 })).map((r) => r.url)).toEqual(['/pay/charge'])
  expect(await rt.requests.list({ status: 404 })).toHaveLength(2)
  expect((await rt.requests.list({ q: 'PAYMENTS' })).map((r) => r.url)).toEqual(['/payments/x'])
  expect((await rt.requests.list({ q: 'bananas' })).map((r) => r.url)).toEqual(['/pay/charge'])
  expect(await rt.requests.list({ limit: 1 })).toHaveLength(1)
})

test('since excludes older requests', async () => {
  // The cut comes from WireMock's own clock (the logged time of /old), never from this process: the
  // container's clock can drift from the host's by more than any sleep. WireMock's since is exclusive.
  await hit('/old')
  const [old] = await rt.requests.list({})
  await new Promise((r) => setTimeout(r, 20))
  await hit('/new')
  expect((await rt.requests.list({ since: old!.loggedAt })).map((r) => r.url)).toEqual(['/new'])
  expect(await rt.requests.list({})).toHaveLength(2)
})

test('marker requests are hidden', async () => {
  await hit('/__wiremock-ui/marker')
  await hit('/visible')
  expect((await rt.requests.list({})).map((r) => r.url)).toEqual(['/visible'])
})

test('get returns full detail with body; unknown or malformed id is NotFound', async () => {
  await traffic()
  const row = (await rt.requests.list({ matched: true }))[0]
  const detail = await rt.requests.get(row.id)
  expect(detail.request.body).toBe('amount=Bananas')
  expect(detail.response?.body).toBe('charged')
  await expect(rt.requests.get('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundError)
  await expect(rt.requests.get('nope')).rejects.toBeInstanceOf(NotFoundError)
})

test('count and clear (clear is audited)', async () => {
  await hit('/x')
  await hit('/x')
  expect(await rt.requests.count({ method: 'GET', urlPath: '/x' })).toBe(2)
  await rt.requests.clear('ui-admin')
  expect(await rt.requests.list({})).toEqual([])
  expect((await rt.audit.list()).entries.some((a) => a.action === 'requests.clear' && a.actor === 'ui-admin')).toBe(true)
})

test("a request the recording's proxy answered says where it was forwarded", async () => {
  const id = '9c0f1a52-6c4e-4c0e-9d7a-6a7d1f0e0b11'
  await rt.wiremock.importStubs(
    [{ id, priority: 9, request: { method: 'ANY' }, response: { proxyBaseUrl: 'http://127.0.0.1:9' } }],
    { deleteAllNotInImport: false },
  )
  try {
    await hit('/elsewhere/thing')
    const [row] = await rt.requests.list({ limit: 1 })
    expect(row).toMatchObject({ url: '/elsewhere/thing', matched: true, stubId: id, recordingProxy: true, forwardedTo: 'http://127.0.0.1:9' })
    await hit('/pay/charge', { method: 'POST' })
    const [plain] = await rt.requests.list({ limit: 1 })
    expect(plain).toMatchObject({ recordingProxy: false, forwardedTo: null })
  } finally {
    await rt.wiremock.deleteStub(id).catch(() => undefined)
  }
})
