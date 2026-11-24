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
  const user = (username: string) => ({ id: username, username, displayName: username, disabled: false, createdAt: '', updatedAt: '' })
  const tessUser = user(tess.username)
  const adminUser = user('ui-admin')
  await rt.mocks.create({ name: 'Charge ok', request: { method: 'POST', urlPath: '/pay/charge' }, response: { status: 200, jsonBody: { ok: true } }, metadata: { wiremockUi: { tags: ['pay'] } } }, adminUser)
  await rt.mocks.create({ name: 'Logo / PNG', request: { method: 'GET', urlPath: '/pay/logo' }, response: { status: 200, base64Body: 'iVBORw0KGgo=', headers: { 'Content-Type': 'image/png' } }, metadata: { wiremockUi: { tags: ['pay', 'assets'] } } }, tessUser)
  await rt.mocks.create({ name: 'Citizen', request: { method: 'GET', urlPath: '/nic/citizen' }, response: { status: 404 }, metadata: { wiremockUi: { tags: ['nic'] } } }, adminUser)
}, 120_000)
afterAll(async () => {
  await fresh?.stop()
  await env?.stop()
})

const get = (query: string, s: Session = admin) => exportMocks(env.rt, req(`/api/export${query}`, 'GET', undefined, as(s)))
const names = (stubs: StubMapping[]) => stubs.map((s) => s.name).sort()

test('a bundle of everything: the mocks (with their tags), as a JSON attachment', async () => {
  const res = await get('')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('application/json')
  expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="wiremock-ui-all-\d{8}-\d{4}\.json"$/)
  const bundle = await res.json()
  expect(Object.keys(bundle).sort()).toEqual(['catalog', 'integrations', 'mocks', 'oidcIdentities'])
  expect(bundle.oidcIdentities).toEqual([])
  expect(bundle.integrations).toEqual([])
  expect(bundle.catalog).toEqual([])
  expect(names(bundle.mocks)).toEqual(expect.arrayContaining(['Charge ok', 'Citizen', 'Logo / PNG']))
})

test('scope=tag keeps the mocks with that tag', async () => {
  const res = await get('?scope=tag&tag=nic')
  expect(res.headers.get('content-disposition')).toMatch(/filename="wiremock-ui-nic-\d{8}-\d{4}\.json"/)
  expect(names((await res.json()).mocks)).toEqual(['Citizen'])
  expect(names((await (await get('?scope=tag&tag=PAY')).json()).mocks)).toEqual(['Charge ok', 'Logo / PNG'])
})

test('scope=mine keeps the caller\'s mocks', async () => {
  const bundle = await (await get('?scope=mine', tess)).json()
  expect(names(bundle.mocks)).toEqual(STORELESS ? ['Charge ok', 'Citizen', 'Logo / PNG'] : ['Logo / PNG'])
})

test('bad parameters are 400; an unknown tag is an empty export', async () => {
  expect((await get('?scope=everything')).status).toBe(400)
  expect((await get('?format=tar')).status).toBe(400)
  expect((await get('?scope=tag')).status).toBe(400)
  expect((await get('?scope=integration&integration=pay')).status).toBe(400)
  expect((await (await get('?scope=tag&tag=nope')).json()).mocks).toEqual([])
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
      .map((s) => ({ id: s.id, name: s.name, request: s.request, response: s.response, owner: s.metadata!.wiremockUi!.owner, tags: s.metadata!.wiremockUi!.tags }))
      .sort((a, b) => a.id.localeCompare(b.id))
  expect(essence(await fresh.rt.store.listAll())).toEqual(essence(await env.rt.store.listAll()))
  // WireMock serves the imported binary body.
  const logo = await fetch(`${fresh.wm.url}/pay/logo`)
  expect(Buffer.from(await logo.arrayBuffer()).toString('base64')).toBe('iVBORw0KGgo=')
})
