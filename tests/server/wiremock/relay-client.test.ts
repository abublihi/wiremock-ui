import { expect, test } from 'vitest'
import { WireMockClient } from '../../../src/server/wiremock/client'

test('the relay never sends the admin credentials and never follows redirects', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: URL | string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return new Response('moved', { status: 302, headers: { Location: 'http://elsewhere.test/', 'Matched-Stub-Id': 'abc' } })
  }) as typeof globalThis.fetch
  const wm = new WireMockClient({ baseUrl: 'http://wm.test:8080', user: 'admin', password: 'secret', fetch })
  const res = await wm.sendTestRequest({ method: 'GET', path: '/r', headers: { 'X-A': '1' } })
  // The second call reads the request log (here a 302, so the header's id stands); only the first is the relay.
  expect(calls[1].url).toBe('http://wm.test:8080/__admin/requests?limit=20')
  expect(res).toMatchObject({ status: 302, matchedStubId: 'abc', body: 'moved', headers: { location: 'http://elsewhere.test/' } })
  expect(calls[0].url).toBe('http://wm.test:8080/r')
  expect(calls[0].init.redirect).toBe('manual')
  // identity unless the tester asks otherwise, so the reported headers describe the body as sent.
  expect(calls[0].init.headers).toEqual({ 'X-A': '1', 'Accept-Encoding': 'identity' })
  await wm.sendTestRequest({ method: 'GET', path: '/r', headers: { 'accept-encoding': 'gzip' } })
  expect(calls[2].init.headers).toEqual({ 'accept-encoding': 'gzip' })
})

test('a WireMock that does not answer in time is a 504 naming the limit', async () => {
  const fetch = ((_url: unknown, init: RequestInit = {}) =>
    new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof globalThis.fetch
  const wm = new WireMockClient({ baseUrl: 'http://wm.test:8080', fetch, relayTimeoutMs: 50 })
  const err = await wm.sendTestRequest({ method: 'GET', path: '/slow' }).catch((e: unknown) => e)
  expect(err).toMatchObject({ status: 504, message: 'WireMock did not answer within 0 s' })
})

test('proxyFailure reads WireMock\'s own 500 for a forward that could not connect', async () => {
  const { proxyFailure } = await import('../../../src/server/wiremock/client')
  expect(
    proxyFailure('Network failure trying to make a proxied request from WireMock to http://localhost:3999/bad\nConnect to http://localhost:3999 failed: Connection refused (Connection refused){}'),
  ).toEqual({ target: 'http://localhost:3999', message: 'Connect to http://localhost:3999 failed: Connection refused (Connection refused)' })
  expect(proxyFailure('Internal error')).toBeNull()
})
