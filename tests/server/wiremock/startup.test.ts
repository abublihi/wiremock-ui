import { afterAll, beforeAll, expect, test } from 'vitest'
import { UpstreamError } from '../../../src/server/errors'
import { WireMockClient } from '../../../src/server/wiremock/client'
import { assertWireMockReady } from '../../../src/server/wiremock/startup'
import { startWireMock, type WireMockHandle } from '../../helpers/containers'

const started: WireMockHandle[] = []
let authed: WireMockHandle
let open: WireMockHandle

beforeAll(async () => {
  authed = await startWireMock()
  open = await startWireMock({ auth: false })
  started.push(authed, open)
})
afterAll(async () => {
  await Promise.all(started.map((h) => h.stop()))
})

const clientFor = (h: WireMockHandle, password = h.password) =>
  new WireMockClient({ baseUrl: h.url, user: h.user, password })

test('passes against WireMock with admin auth', async () => {
  await expect(assertWireMockReady(clientFor(authed), authed.url)).resolves.toBeUndefined()
})

test('refuses WireMock without admin auth', async () => {
  await expect(assertWireMockReady(clientFor(open), open.url)).rejects.toThrow('answers without auth')
})

test('rejects wrong credentials', async () => {
  await expect(assertWireMockReady(clientFor(authed, 'nope'), authed.url)).rejects.toThrow(
    'WireMock admin credentials rejected',
  )
})

test('refuses WireMock 2.x', async () => {
  const fake = (async (input: RequestInfo | URL) => {
    const u = String(input)
    if (u.includes('/__admin/version')) return new Response(JSON.stringify({ version: '2.35.0' }), { status: 200 })
    return new Response('unauthorized', { status: 401 })
  }) as typeof fetch
  const client = new WireMockClient({ baseUrl: 'http://wm', user: 'a', password: 'b', fetch: fake })
  await expect(assertWireMockReady(client, 'http://wm', fake)).rejects.toThrow(
    'WireMock 3.x is required, found 2.35.0',
  )
})

test('unreachable WireMock is an UpstreamError, not a raw TypeError', async () => {
  const down = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  const client = new WireMockClient({ baseUrl: 'http://wm', user: 'a', password: 'b', fetch: down })
  const err = await assertWireMockReady(client, 'http://wm', down).catch((e) => e)
  expect(err).toBeInstanceOf(UpstreamError)
  expect(err.message).toBe('WireMock unreachable at http://wm: fetch failed')
})

test('a 500 from the authenticated version call propagates as UpstreamError, not credentials rejected', async () => {
  const fake = (async (input: RequestInfo | URL) =>
    String(input).includes('/__admin/version')
      ? new Response('boom', { status: 500 })
      : new Response('unauthorized', { status: 401 })) as typeof fetch
  const client = new WireMockClient({ baseUrl: 'http://wm', user: 'a', password: 'b', fetch: fake })
  await expect(assertWireMockReady(client, 'http://wm', fake)).rejects.toBeInstanceOf(UpstreamError)
})

test('401 with no configured user tells the operator to set credentials', async () => {
  const fake = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch
  const client = new WireMockClient({ baseUrl: 'http://wm', fetch: fake })
  await expect(assertWireMockReady(client, 'http://wm', fake)).rejects.toThrow(
    'WireMock admin API requires credentials; set WIREMOCK_ADMIN_USER and WIREMOCK_ADMIN_PASSWORD',
  )
})
