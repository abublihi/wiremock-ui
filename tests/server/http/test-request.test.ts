import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { createMock } from '../../../src/server/http/handlers/mocks'
import { sendTestRequest } from '../../../src/server/http/handlers/test'
import type { Runtime } from '../../../src/server/runtime'
import { basic, login, req as baseReq, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const req = (body: unknown, headers: Record<string, string> = auth) => baseReq('/api/test-request', 'POST', body, headers)
const relay = async (body: unknown) => {
  const res = await sendTestRequest(rt, req(body))
  return { status: res.status, json: await res.json() }
}
const adminAuth = () => `Basic ${Buffer.from(`${env.wm.user}:${env.wm.password}`).toString('base64')}`
const journal = async () =>
  (await (await fetch(`${env.wm.url}/__admin/requests`, { headers: { Authorization: adminAuth() } })).json()).requests as {
    request: { url: string; method: string; headers: Record<string, string>; body: string }
  }[]

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
}, 120_000)
afterAll(async () => {
  await env?.stop()
})
beforeEach(async () => {
  await fetch(`${env.wm.url}/__admin/requests`, { method: 'DELETE', headers: { Authorization: adminAuth() } })
})

test('needs a signed-in user, JSON and (for a session) the CSRF token', async () => {
  expect((await sendTestRequest(rt, req({ method: 'GET', path: '/x' }, {}))).status).toBe(401)
  expect((await sendTestRequest(rt, baseReq('/api/test-request', 'POST', '{"method":"GET","path":"/x"}', { ...auth, 'Content-Type': 'text/plain' }))).status).toBe(415)
  const s = await login(rt, 'ui-admin', 'ui-admin-pass')
  expect((await sendTestRequest(rt, req({ method: 'GET', path: '/x' }, { Cookie: s.cookie }))).status).toBe(403)
  expect((await sendTestRequest(rt, req({ method: 'GET', path: '/x' }, { Cookie: s.cookie, 'X-CSRF-Token': s.csrf }))).status).toBe(200)
})

test('success: status, headers, body, matchedStubId and durationMs; the request reaches WireMock as sent', async () => {
  const created = await createMock(
    rt,
    baseReq('/api/mocks', 'POST', {
      request: { method: 'POST', urlPath: '/relay/orders', queryParameters: { a: { equalTo: '1' } } },
      response: { status: 201, headers: { 'Content-Type': 'application/json', 'X-Order': 'o-1' }, jsonBody: { ok: 'é' } },
    }, auth),
  )
  const stub = await created.json()
  const { status, json } = await relay({
    method: 'POST',
    path: '/relay/orders',
    query: { a: '1' },
    headers: { 'Content-Type': 'application/json', 'X-Test': 'yes', Host: 'evil.test', Connection: 'close' },
    body: '{"id":1}',
  })
  expect(status).toBe(200)
  expect(json).toMatchObject({ status: 201, body: '{"ok":"é"}', bodyIsBase64: false, bodyTruncated: false, matchedStubId: stub.id })
  expect(json.headers['x-order']).toBe('o-1')
  expect(json.headers['content-type']).toContain('application/json')
  expect(typeof json.durationMs).toBe('number')
  expect(json.durationMs).toBeGreaterThanOrEqual(0)

  const [logged] = await journal()
  expect(logged.request).toMatchObject({ url: '/relay/orders?a=1', method: 'POST', body: '{"id":1}' })
  expect(logged.request.headers['X-Test']).toBe('yes')
  // Host is WireMock's own, never the caller's; WireMock admin credentials are never sent on the relay.
  expect(logged.request.headers.Host).not.toBe('evil.test')
  expect(Object.keys(logged.request.headers).map((h) => h.toLowerCase())).not.toContain('authorization')
})

test('an unmatched request comes back as WireMock answered it, with matchedStubId null', async () => {
  const { json } = await relay({ method: 'GET', path: '/relay/nothing-here' })
  expect(json).toMatchObject({ status: 404, matchedStubId: null, bodyIsBase64: false })
})

test('redirects are returned, never followed', async () => {
  await createMock(rt, baseReq('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/relay/redirect' }, response: { status: 302, headers: { Location: 'http://example.test/elsewhere' } } }, auth))
  const { json } = await relay({ method: 'GET', path: '/relay/redirect' })
  expect(json.status).toBe(302)
  expect(json.headers.location).toBe('http://example.test/elsewhere')
})

test('binary bodies come back base64; bodies over 1 MB are truncated', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])
  await createMock(rt, baseReq('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/relay/png' }, response: { status: 200, headers: { 'Content-Type': 'image/png' }, base64Body: bytes.toString('base64') } }, auth))
  expect((await relay({ method: 'GET', path: '/relay/png' })).json).toMatchObject({ body: bytes.toString('base64'), bodyIsBase64: true })

  await createMock(rt, baseReq('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/relay/big' }, response: { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'x'.repeat(1024 * 1024 + 10) } }, auth))
  const big = (await relay({ method: 'GET', path: '/relay/big' })).json
  expect(big.bodyTruncated).toBe(true)
  expect(big.body.length).toBe(1024 * 1024)
})

test.each([
  ['absolute URL', { method: 'GET', path: 'http://example.test/' }],
  ['scheme-relative URL', { method: 'GET', path: '//example.test/' }],
  ['admin API', { method: 'GET', path: '/__admin/mappings' }],
  ['admin API, other case', { method: 'GET', path: '/__Admin/mappings' }],
  ['dot-dot to admin', { method: 'GET', path: '/x/../__admin/mappings' }],
  ['encoded dot-dot to admin', { method: 'GET', path: '/x/%2e%2e/__admin/mappings' }],
  ['dot-dot with matrix param', { method: 'GET', path: '/x/..;/__admin/mappings' }],
  ['encoded slash', { method: 'GET', path: '/x%2f..%2f__admin%2fmappings' }],
  ['CRLF in a header value', { method: 'GET', path: '/x', headers: { 'X-A': 'v\r\nX-Injected: 1' } }],
  ['CRLF in a header name', { method: 'GET', path: '/x', headers: { 'X-A\r\nX-Injected': '1' } }],
  ['CRLF in the path', { method: 'GET', path: '/x\r\nX-Injected: 1' }],
  ['CRLF in the query', { method: 'GET', path: '/x', query: 'a=1\r\nX-Injected: 1' }],
  ['unknown method', { method: 'TRACE', path: '/x' }],
  ['body on GET', { method: 'GET', path: '/x', body: 'x' }],
])('refuses %s with 400 and sends nothing to WireMock', async (_label, body) => {
  const { status, json } = await relay(body)
  expect(status).toBe(400)
  expect(typeof json.error).toBe('string')
  expect(await journal()).toEqual([])
})

test('refuses a request body over 1 MB with 413', async () => {
  const { status } = await relay({ method: 'POST', path: '/x', body: 'x'.repeat(1024 * 1024 + 1) })
  expect(status).toBe(413)
})

test('a webhook mock created through the API really calls its target; a proxy mock really proxies', async () => {
  await createMock(rt, baseReq('/api/mocks', 'POST', { request: { method: 'POST', urlPath: '/relay/cb' }, response: { status: 204 } }, auth))
  const hook = await createMock(
    rt,
    baseReq('/api/mocks', 'POST', {
      request: { method: 'POST', urlPath: '/relay/pay' },
      response: { status: 202, body: 'accepted' },
      serveEventListeners: [{ name: 'webhook', parameters: { method: 'POST', url: 'http://localhost:8080/relay/cb', headers: { 'X-Hook': '1' }, body: '{{jsonPath originalRequest.body \'$.id\'}}', delay: { type: 'fixed', milliseconds: 10 } } }],
    }, auth),
  )
  expect(hook.status).toBe(201)
  expect((await relay({ method: 'POST', path: '/relay/pay', headers: { 'Content-Type': 'application/json' }, body: '{"id":"p-9"}' })).json.status).toBe(202)
  const until = Date.now() + 5000
  let cb: Awaited<ReturnType<typeof journal>>[number] | undefined
  while (!cb && Date.now() < until) {
    cb = (await journal()).find((e) => e.request.url === '/relay/cb')
    if (!cb) await new Promise((r) => setTimeout(r, 100))
  }
  expect(cb?.request.body).toBe('p-9')
  expect(cb?.request.headers['X-Hook']).toBe('1')

  await createMock(rt, baseReq('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/relay/upstream/item' }, response: { status: 200, body: 'upstream says hi' } }, auth))
  const px = await createMock(
    rt,
    baseReq('/api/mocks', 'POST', {
      request: { method: 'GET', urlPathPattern: '/relay/px/.*' },
      response: { proxyBaseUrl: 'http://localhost:8080/relay/upstream', proxyUrlPrefixToRemove: '/relay/px', removeProxyRequestHeaders: ['X-Secret'] },
    }, auth),
  )
  expect(px.status).toBe(201)
  const proxied = (await relay({ method: 'GET', path: '/relay/px/item', headers: { 'X-Secret': 's' } })).json
  expect(proxied).toMatchObject({ status: 200, body: 'upstream says hi' })
  const upstream = (await journal()).find((e) => e.request.url === '/relay/upstream/item')
  expect(upstream?.request.headers['X-Secret']).toBeUndefined()
})
