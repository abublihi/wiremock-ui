import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { exportMocks } from '../../../src/server/http/handlers/export'
import { runImport } from '../../../src/server/http/handlers/imports'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { STORELESS, login, req, signIn, startTestRuntime } from '../../helpers/http'

// GET /api/export (spec A6, partly pulled forward): a bundle or a zip of WireMock mapping files, on every driver.

let env: Awaited<ReturnType<typeof startTestRuntime>>
let fresh: Awaited<ReturnType<typeof startTestRuntime>> | undefined
type Session = { cookie: string; csrf: string }
let admin: Session
let tess: Session & { username: string }
const as = (s: Session) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf })

beforeAll(async () => {
  env = await startTestRuntime()
  const { rt } = env
  admin = await login(rt, 'ui-admin', 'ui-admin-pass')
  tess = await signIn(rt, 'tess')
  await rt.catalog.upsertIntegration({ key: 'pay', name: 'Payments', prefix: '/pay' }, 'ui-admin')
  await rt.catalog.upsertIntegration({ key: 'nic', name: 'NIC', prefix: '/nic' }, 'ui-admin')
  await rt.catalog.upsertEndpoint(
    { integration: 'pay', key: 'charge', name: 'Charge', method: 'POST', path: '/charge', pathType: 'exact', contentType: 'json', exampleResponses: { '200': '{}' }, allowedStatuses: [200] },
    'ui-admin',
  )
  const user = (username: string) => ({ id: username, username, displayName: username, disabled: false, createdAt: '', updatedAt: '' })
  const tessUser = user(tess.username)
  const adminUser = user('ui-admin')
  await rt.mocks.create({ name: 'Charge ok', request: { method: 'POST', urlPath: '/pay/charge' }, response: { status: 200, jsonBody: { ok: true } }, metadata: { wiremockUi: { integration: 'pay', endpoint: 'charge' } } }, adminUser)
  await rt.mocks.create({ name: 'Logo / PNG', request: { method: 'GET', urlPath: '/pay/logo' }, response: { status: 200, base64Body: 'iVBORw0KGgo=', headers: { 'Content-Type': 'image/png' } }, metadata: { wiremockUi: { integration: 'pay' } } }, tessUser)
  await rt.mocks.create({ name: 'Citizen', request: { method: 'GET', urlPath: '/nic/citizen' }, response: { status: 404 }, metadata: { wiremockUi: { integration: 'nic' } } }, adminUser)
}, 120_000)
afterAll(async () => {
  await fresh?.stop()
  await env?.stop()
})

const get = (query: string, s: Session = admin) => exportMocks(env.rt, req(`/api/export${query}`, 'GET', undefined, as(s)))
const names = (stubs: StubMapping[]) => stubs.map((s) => s.name).sort()

test('a bundle of everything: integrations, catalog and mocks, as a JSON attachment', async () => {
  const res = await get('')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('application/json')
  expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="wiremock-ui-all-\d{8}-\d{4}\.json"$/)
  const bundle = await res.json()
  expect(Object.keys(bundle).sort()).toEqual(['catalog', 'integrations', 'mocks', 'oidcIdentities'])
  expect(bundle.oidcIdentities).toEqual([])
  // Catalog entries without the server-owned fields, so they import as they are.
  expect(bundle.integrations).toEqual(expect.arrayContaining([{ key: 'pay', name: 'Payments', prefix: '/pay' }, { key: 'nic', name: 'NIC', prefix: '/nic' }]))
  expect(bundle.catalog).toEqual([expect.objectContaining({ integration: 'pay', key: 'charge' })])
  expect(bundle.catalog[0]).not.toHaveProperty('updatedAt')
  expect(names(bundle.mocks)).toEqual(expect.arrayContaining(['Charge ok', 'Citizen', 'Logo / PNG']))
})

test('scope=integration keeps that integration, its endpoints and its mocks', async () => {
  const res = await get('?scope=integration&integration=nic')
  expect(res.headers.get('content-disposition')).toMatch(/filename="wiremock-ui-nic-\d{8}-\d{4}\.json"/)
  const bundle = await res.json()
  expect(bundle.integrations).toEqual([{ key: 'nic', name: 'NIC', prefix: '/nic' }])
  expect(bundle.catalog).toEqual([])
  expect(names(bundle.mocks)).toEqual(['Citizen'])
})

test('scope=mine keeps the caller\'s mocks and the catalog they link to', async () => {
  const bundle = await (await get('?scope=mine', tess)).json()
  expect(names(bundle.mocks)).toEqual(STORELESS ? ['Charge ok', 'Citizen', 'Logo / PNG'] : ['Logo / PNG'])
  expect(bundle.integrations.map((i: { key: string }) => i.key)).toContain('pay')
})

test('bad parameters are 400; an unknown integration is 404', async () => {
  expect((await get('?scope=everything')).status).toBe(400)
  expect((await get('?format=tar')).status).toBe(400)
  expect((await get('?scope=integration')).status).toBe(400)
  expect((await get('?scope=integration&integration=nope')).status).toBe(404)
})

test('format=mappings is a zip of mappings/<name>-<id>.json files WireMock can load', async () => {
  const res = await get('?format=mappings')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/zip')
  expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="wiremock-ui-all-mappings-\d{8}-\d{4}\.zip"$/)
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const paths = Object.keys(files)
  for (const p of paths) expect(p).toMatch(/^mappings\/[a-z0-9-]+-[0-9a-f-]{36}\.json$/)
  const logo = paths.find((p) => p.startsWith('mappings/logo-png-'))!
  const stub = JSON.parse(strFromU8(files[logo]))
  expect(stub).toMatchObject({ name: 'Logo / PNG', response: { base64Body: 'iVBORw0KGgo=' } })
  expect(logo).toBe(`mappings/logo-png-${stub.id}.json`)
})

test('round trip: export → import into an empty store → the same mocks', async () => {
  const exported = await (await get('')).json()
  fresh = await startTestRuntime()
  const freshAdmin = await login(fresh.rt, 'ui-admin', 'ui-admin-pass')
  const res = await runImport(fresh.rt, req('/api/import', 'POST', exported, as(freshAdmin)))
  expect(res.status).toBe(200)
  const essence = (stubs: StubMapping[]) =>
    stubs
      .filter((s) => s.metadata?.wiremockUi)
      .map((s) => ({ id: s.id, name: s.name, request: s.request, response: s.response, owner: s.metadata!.wiremockUi!.owner, integration: s.metadata!.wiremockUi!.integration, endpoint: s.metadata!.wiremockUi!.endpoint }))
      .sort((a, b) => a.id.localeCompare(b.id))
  expect(essence(await fresh.rt.store.listAll())).toEqual(essence(await env.rt.store.listAll()))
  expect((await fresh.rt.catalog.listIntegrations()).map((i) => i.key).sort()).toEqual(['nic', 'pay'])
  expect(await fresh.rt.catalog.findEndpoint('pay', 'charge')).not.toBeNull()
  // WireMock serves the imported binary body.
  const logo = await fetch(`${fresh.wm.url}/pay/logo`)
  expect(Buffer.from(await logo.arrayBuffer()).toString('base64')).toBe('iVBORw0KGgo=')
})
