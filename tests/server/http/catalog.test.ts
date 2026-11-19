import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createCatalogMock,
  deleteEndpoint,
  deleteIntegration,
  getEndpoint,
  listEndpoints,
  listIntegrations,
  putEndpoint,
  previewMock,
  putIntegration,
} from '../../../src/server/http/handlers/catalog'
import { createMock } from '../../../src/server/http/handlers/mocks'
import type { Runtime } from '../../../src/server/runtime'
import { login, req, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
type Session = { cookie: string; csrf: string }
let admin: Session
let developer: Session
let tester: Session
const as = (s: Session) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf })

const endpointBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Get user',
  method: 'GET',
  path: '/users/{id}',
  pathType: 'template',
  lookup: { location: 'path', expression: 'id' },
  contentType: 'json',
  exampleResponses: { '200': '{"ok":true}' },
  allowedStatuses: [200],
  ...extra,
})

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  await rt.users.create({ username: 'dev1', role: 'developer', password: 'password-1' }, 'ui-admin')
  await rt.users.create({ username: 'tess', role: 'tester', password: 'password-1' }, 'ui-admin')
  admin = await login(rt, 'ui-admin', 'ui-admin-pass')
  developer = await login(rt, 'dev1', 'password-1')
  tester = await login(rt, 'tess', 'password-1')
}, 120_000)

afterAll(async () => {
  await env?.stop()
})

const putInt = (s: Session, key: string, body: unknown = { name: 'Payments', prefix: '/pay' }) =>
  putIntegration(rt, req(`/api/integrations/${key}`, 'PUT', body, as(s)), { key })

test('roles: tester PUT 403, developer PUT 200, developer DELETE 403, admin DELETE 204', async () => {
  expect((await putInt(tester, 'roles')).status).toBe(403)
  const ok = await putInt(developer, 'roles')
  expect(ok.status).toBe(200)
  expect(await ok.json()).toMatchObject({ key: 'roles', name: 'Payments', prefix: '/pay', updatedBy: 'dev1' })
  const devDel = await deleteIntegration(rt, req('/api/integrations/roles', 'DELETE', undefined, as(developer)), { key: 'roles' })
  expect(devDel.status).toBe(403)
  const adminDel = await deleteIntegration(rt, req('/api/integrations/roles', 'DELETE', undefined, as(admin)), { key: 'roles' })
  expect(adminDel.status).toBe(204)
  expect((await listIntegrations(rt, req('/api/integrations', 'GET', undefined, as(tester)))).status).toBe(200)
})

test('endpoint CRUD over HTTP, body key mismatch → 400, validation → 400, unknown integration → 404', async () => {
  expect((await putInt(developer, 'crud')).status).toBe(200)
  const params = { key: 'crud', endpoint: 'get-user' }
  const path = '/api/integrations/crud/endpoints/get-user'

  const mismatch = await putEndpoint(rt, req(path, 'PUT', endpointBody({ key: 'other' }), as(developer)), params)
  expect(mismatch.status).toBe(400)
  expect(await mismatch.json()).toEqual({ error: 'key in body does not match the path' })
  const intMismatch = await putInt(developer, 'crud', { key: 'nope', name: 'x', prefix: '/x' })
  expect(intMismatch.status).toBe(400)
  expect(await intMismatch.json()).toEqual({ error: 'key in body does not match the path' })

  const bad = await putEndpoint(rt, req(path, 'PUT', endpointBody({ path: 'users' }), as(developer)), params)
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'path must start with /' })
  expect((await putEndpoint(rt, req(path, 'PUT', endpointBody(), as(tester)), params)).status).toBe(403)

  const created = await putEndpoint(rt, req(path, 'PUT', endpointBody(), as(developer)), params)
  expect(created.status).toBe(200)
  expect(await created.json()).toMatchObject({ integration: 'crud', key: 'get-user', updatedBy: 'dev1' })
  const got = await getEndpoint(rt, req(path, 'GET', undefined, as(tester)), params)
  expect((await got.json()).name).toBe('Get user')
  const list = await listEndpoints(rt, req('/api/integrations/crud/endpoints', 'GET', undefined, as(tester)), { key: 'crud' })
  expect((await list.json()).map((e: { key: string }) => e.key)).toEqual(['get-user'])

  const ghost = await putEndpoint(rt, req('/api/integrations/ghost/endpoints/x', 'PUT', endpointBody(), as(developer)), { key: 'ghost', endpoint: 'x' })
  expect(ghost.status).toBe(404)

  expect((await deleteEndpoint(rt, req(path, 'DELETE', undefined, as(developer)), params)).status).toBe(403)
  expect((await deleteEndpoint(rt, req(path, 'DELETE', undefined, as(admin)), params)).status).toBe(204)
  expect((await getEndpoint(rt, req(path, 'GET', undefined, as(admin)), params)).status).toBe(404)
})

test('deleting an integration that still has mocks → 409', async () => {
  expect((await putInt(developer, 'busy')).status).toBe(200)
  const mock = await createMock(
    rt,
    req('/api/mocks', 'POST', {
      request: { method: 'GET', urlPath: '/pay/busy' },
      response: { status: 200, body: 'x' },
      metadata: { wiremockUi: { integration: 'busy' } },
    }, as(admin)),
  )
  expect(mock.status).toBe(201)
  const res = await deleteIntegration(rt, req('/api/integrations/busy', 'DELETE', undefined, as(admin)), { key: 'busy' })
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Integration still has mocks' })
})

test('audit entries are written through the HTTP path', async () => {
  const actions = (await rt.audit.list()).entries.map((e) => e.action)
  expect(actions).toEqual(expect.arrayContaining(['catalog.integration.upsert', 'catalog.integration.delete', 'catalog.endpoint.upsert', 'catalog.endpoint.delete']))
})

test('preview and create mocks from an endpoint over HTTP', async () => {
  expect((await putInt(developer, 'bld', { name: 'Build', prefix: '/b' })).status).toBe(200)
  const params = { key: 'bld', endpoint: 'get-user' }
  const base = '/api/integrations/bld/endpoints/get-user'
  expect((await putEndpoint(rt, req(base, 'PUT', endpointBody(), as(developer)), params)).status).toBe(200)
  const form = { keyValue: '7', status: 200, body: '{"id":7}' }

  const preview = await previewMock(rt, req(`${base}/preview`, 'POST', form, as(tester)), params)
  expect(preview.status).toBe(200)
  expect(await preview.json()).toMatchObject({ priority: 5, request: { urlPathTemplate: '/b/users/{id}' } })

  expect((await createCatalogMock(rt, req(`${base}/mocks`, 'POST', form, as(tester)), params)).status).toBe(201)
  const created = await createCatalogMock(rt, req(`${base}/mocks`, 'POST', form, as(developer)), params)
  expect(created.status).toBe(201)
  expect(await created.json()).toMatchObject({ response: { jsonBody: { id: 7 } }, metadata: { wiremockUi: { integration: 'bld', endpoint: 'get-user' } } })

  const bad = await createCatalogMock(rt, req(`${base}/mocks`, 'POST', { ...form, status: 500 }, as(developer)), params)
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'status 500 is not allowed for this endpoint' })
  expect((await createCatalogMock(rt, req(`${base}/mocks`, 'POST', { ...form, nope: 1 }, as(developer)), params)).status).toBe(400)
  const missing = await createCatalogMock(rt, req('/api/integrations/bld/endpoints/zzz/mocks', 'POST', form, as(developer)), { key: 'bld', endpoint: 'zzz' })
  expect(missing.status).toBe(404)
  const text = await previewMock(rt, req(`${base}/preview`, 'POST', JSON.stringify(form), { ...as(tester), 'Content-Type': 'text/plain' }), params)
  expect(text.status).toBe(415)
})
