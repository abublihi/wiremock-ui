import { afterAll, beforeAll, expect, test } from 'vitest'
import { previewQuickMock } from '../../../src/server/http/handlers/catalog'
import { createMock, getMock } from '../../../src/server/http/handlers/mocks'
import { login, req, startTestRuntime } from '../../helpers/http'

// "Mock a URL directly": the quick form's stub is built (and checked) by the server, saved like any mock and served.

let env: Awaited<ReturnType<typeof startTestRuntime>>
let admin: { cookie: string; csrf: string }
const as = () => ({ Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf })

beforeAll(async () => {
  env = await startTestRuntime()
  admin = await login(env.rt, 'ui-admin', 'ui-admin-pass')
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

const preview = (body: unknown) => previewQuickMock(env.rt, req('/api/mocks/preview', 'POST', body, as()))

test('preview builds the stub; POST /api/mocks saves it and WireMock serves it', async () => {
  const input = {
    request: { method: 'POST', urlType: 'template', url: '/quick/users/{id}', query: { lang: 'en' }, body: '{"active":true}' },
    status: 201,
    headers: { 'Content-Type': 'application/json', 'X-Quick': 'yes' },
    body: '{"created":true}',
  }
  const built = await preview(input)
  expect(built.status).toBe(200)
  const stub = await built.json()
  expect(stub).toEqual({
    name: 'POST /quick/users/{id}',
    request: {
      method: 'POST',
      urlPathTemplate: '/quick/users/{id}',
      queryParameters: { lang: { equalTo: 'en' } },
      bodyPatterns: [{ equalToJson: '{"active":true}', ignoreExtraElements: true }],
    },
    response: { status: 201, headers: { 'Content-Type': 'application/json', 'X-Quick': 'yes' }, jsonBody: { created: true } },
  })

  const created = await createMock(env.rt, req('/api/mocks', 'POST', stub, as()))
  expect(created.status).toBe(201)
  const { id } = await created.json()
  const stored = await (await getMock(env.rt, req(`/api/mocks/${id}`, 'GET', undefined, as()), { id })).json()
  expect(stored).toMatchObject(stub)
  expect(stored.metadata.wiremockUi.integration).toBeUndefined()

  const hit = await fetch(`${env.wm.url}/quick/users/42?lang=en`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: true, extra: 1 }),
  })
  expect(hit.status).toBe(201)
  expect(hit.headers.get('x-quick')).toBe('yes')
  expect(await hit.json()).toEqual({ created: true })
  const miss = await fetch(`${env.wm.url}/quick/users/42?lang=fr`, { method: 'POST', body: '{"active":true}' })
  expect(miss.status).toBe(404)
})

test('a regex URL with a text body match is served too', async () => {
  const stub = await (await preview({ request: { method: 'ANY', urlType: 'regex', url: '/quick/files/[0-9]+', body: 'hello' }, status: 200, body: 'pong' })).json()
  expect((await createMock(env.rt, req('/api/mocks', 'POST', stub, as()))).status).toBe(201)
  const hit = await fetch(`${env.wm.url}/quick/files/7`, { method: 'PUT', body: 'say hello there' })
  expect(hit.status).toBe(200)
  expect(await hit.text()).toBe('pong')
})

test('bad input is a 400 naming the field', async () => {
  const res = await preview({ request: { method: 'GET', urlType: 'path', url: 'no-slash' }, status: 200 })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'request.url must start with /', field: 'request.url' })
  const unknown = await preview({ request: { method: 'GET', urlType: 'path', url: '/x' }, status: 200, keyValue: 'k' })
  expect(unknown.status).toBe(400)
  expect((await unknown.json()).error).toBe('unknown field: keyValue')
})
