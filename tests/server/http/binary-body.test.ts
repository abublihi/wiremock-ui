import { afterAll, beforeAll, expect, test } from 'vitest'
import { createCatalogMock } from '../../../src/server/http/handlers/catalog'
import { runImport } from '../../../src/server/http/handlers/imports'
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
  expect(await bad.json()).toEqual({ error: 'response.base64Body must be valid base64', field: 'response.base64Body' })
  expect((await served('/raw/bad')).status).toBe(404)
  const file = await createMock(env.rt, req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/raw/f' }, response: { status: 200, bodyFileName: 'a.png' } }, as()))
  expect(file.status).toBe(400)
})

// A 5 MB file (the upload limit) is about 6.7 MB of base64: the check must not overflow the regex stack.
const BIG = Buffer.alloc(5 * 1024 * 1024, 0)
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 31 + 7) & 0xff
const BIG_B64 = BIG.toString('base64')

test('a 5 MB binary body saves through Advanced, Simple and import, and WireMock serves it', async () => {
  const advanced = await createMock(env.rt, req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/big/advanced' }, response: { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, base64Body: BIG_B64 } }, as()))
  expect(advanced.status).toBe(201)
  expect((await served('/big/advanced')).bytes.equals(BIG)).toBe(true)

  await env.rt.catalog.upsertEndpoint(
    { integration: 'img', key: 'big', name: 'Big', method: 'GET', path: '/big', pathType: 'exact', contentType: 'json', exampleResponses: {}, allowedStatuses: [] },
    'ui-admin',
  )
  const simple = await createCatalogMock(env.rt, req('/api/integrations/img/endpoints/big/mocks', 'POST', { isDefault: true, status: 200, base64Body: BIG_B64 }, as()), { key: 'img', endpoint: 'big' })
  expect(simple.status).toBe(201)
  expect((await served('/img/big')).bytes.equals(BIG)).toBe(true)

  const imported = await runImport(env.rt, req('/api/import', 'POST', { mocks: [{ id: '0b9c7f3e-5d1a-4f7e-9a51-2f4c8d6e1b99', request: { method: 'GET', urlPath: '/big/imported' }, response: { status: 200, base64Body: BIG_B64 } }] }, as()))
  expect(imported.status).toBe(200)
  expect((await served('/big/imported')).bytes.equals(BIG)).toBe(true)
})

test('a large invalid base64 body is a 400 on every route, not a 500', async () => {
  const bad = `${BIG_B64.slice(0, 4000)}=${BIG_B64.slice(4001)}`
  const advanced = await createMock(env.rt, req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/big/bad' }, response: { status: 200, base64Body: bad } }, as()))
  expect(advanced.status).toBe(400)
  const simple = await createCatalogMock(env.rt, req('/api/integrations/img/endpoints/logo/mocks', 'POST', { isDefault: true, status: 200, base64Body: bad }, as()), { key: 'img', endpoint: 'logo' })
  expect(simple.status).toBe(400)
  const imported = await runImport(env.rt, req('/api/import', 'POST', { mocks: [{ request: { method: 'GET', urlPath: '/big/bad' }, response: { status: 200, base64Body: bad } }] }, as()))
  expect(imported.status).toBe(400)
  expect(await imported.json()).toEqual({ error: expect.stringMatching(/base64Body must be valid base64/) })
})
