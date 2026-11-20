import { afterAll, beforeAll, expect, test } from 'vitest'
import { createCatalogMock } from '../../../src/server/http/handlers/catalog'
import { createMock, getMock } from '../../../src/server/http/handlers/mocks'
import { login, req, startTestRuntime } from '../../helpers/http'

// "Upload body from file": a binary file is stored as base64Body and WireMock serves the identical bytes.

let env: Awaited<ReturnType<typeof startTestRuntime>>
let admin: { cookie: string; csrf: string }
const as = () => ({ Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf })

// A 1×1 PNG followed by every byte value, so nothing in the round trip may treat the body as text.
const PNG = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
])

beforeAll(async () => {
  env = await startTestRuntime()
  admin = await login(env.rt, 'ui-admin', 'ui-admin-pass')
  await env.rt.catalog.upsertIntegration({ key: 'img', name: 'Images', prefix: '/img' }, 'ui-admin')
  await env.rt.catalog.upsertEndpoint(
    { integration: 'img', key: 'logo', name: 'Logo', method: 'GET', path: '/logo', pathType: 'exact', contentType: 'json', exampleResponses: {}, allowedStatuses: [] },
    'ui-admin',
  )
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

const served = async (path: string) => {
  const res = await fetch(`${env.wm.url}${path}`)
  return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) }
}

test('Advanced: a PNG as base64Body is served byte for byte', async () => {
  const stub = { request: { method: 'GET', urlPath: '/raw/logo.png' }, response: { status: 200, headers: { 'Content-Type': 'image/png' }, base64Body: PNG.toString('base64') } }
  const res = await createMock(env.rt, req('/api/mocks', 'POST', stub, as()))
  expect(res.status).toBe(201)
  const { id } = await res.json()
  expect((await (await getMock(env.rt, req(`/api/mocks/${id}`, 'GET', undefined, as()), { id })).json()).response.base64Body).toBe(PNG.toString('base64'))
  const got = await served('/raw/logo.png')
  expect(got.status).toBe(200)
  expect(got.type).toBe('image/png')
  expect(got.bytes.equals(PNG)).toBe(true)
})

test('Simple: base64Body with the file\'s Content-Type is served byte for byte', async () => {
  const input = { isDefault: true, status: 200, base64Body: PNG.toString('base64'), headers: { 'Content-Type': 'image/png' } }
  const res = await createCatalogMock(env.rt, req('/api/integrations/img/endpoints/logo/mocks', 'POST', input, as()), { key: 'img', endpoint: 'logo' })
  expect(res.status).toBe(201)
  const got = await served('/img/logo')
  expect(got.type).toBe('image/png')
  expect(got.bytes.equals(PNG)).toBe(true)
})

test('invalid base64 is 400 and nothing reaches WireMock; bodyFileName stays refused', async () => {
  const bad = await createMock(env.rt, req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/raw/bad' }, response: { status: 200, base64Body: 'not base64!' } }, as()))
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'response.base64Body must be valid base64' })
  expect((await served('/raw/bad')).status).toBe(404)
  const file = await createMock(env.rt, req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/raw/f' }, response: { status: 200, bodyFileName: 'a.png' } }, as()))
  expect(file.status).toBe(400)
})
