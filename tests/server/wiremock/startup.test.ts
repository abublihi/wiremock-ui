import { afterAll, beforeAll, expect, test } from 'vitest'
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
