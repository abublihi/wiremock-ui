import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { logger } from '../../src/server/logger'
import { healthz } from '../../src/server/http/handlers/health'
import { runImport } from '../../src/server/http/handlers/imports'
import { deleteMock, getMock, listMocks, mockHistory, restoreMock, updateMock, createMock } from '../../src/server/http/handlers/mocks'
import { changePassword } from '../../src/server/http/handlers/session'
import { createUser, deleteUser, listUsers, updateUser } from '../../src/server/http/handlers/users'
import { bootRuntime, type Runtime } from '../../src/server/runtime'
import { NO_USER_MANAGEMENT } from '../../src/server/store/memory'
import { MARKER_ID, markerStub } from '../../src/server/sync/marker'
import { WireMockClient } from '../../src/server/wiremock/client'
import type { StubMapping } from '../../src/server/wiremock/types'
import { startWireMock, type WireMockHandle } from '../helpers/containers'
import { basic, login, req } from '../helpers/http'

// WireMock-only mode (spec A10): WireMock's own stubs are the mocks; nothing is stored.
const uid = (n: number) => `0000b0b0-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = (n: number, path: string, extra: Partial<StubMapping> = {}): StubMapping => ({
  id: uid(n),
  name: `own ${n}`,
  request: { method: 'GET', urlPath: path },
  response: { status: 200, body: `own-${n}` },
  ...extra,
})

let wm: WireMockHandle
let client: WireMockClient
let rt: Runtime
let env: Record<string, string>
let seedPruneWarned = false
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const ids = (list: StubMapping[]) => list.map((s) => s.id).sort()

beforeAll(async () => {
  wm = await startWireMock()
  client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
  // A marker left behind by an earlier, store-backed UI must not show up as a mock.
  await client.importStubs([own(1, '/one'), own(2, '/two', { persistent: true }), own(3, '/three'), markerStub(), own(4, '/old-baseline', { metadata: { wiremockUi: { owner: 'baseline', version: 1, updatedAt: '', updatedBy: 'x', source: 'seed' } } })], { deleteAllNotInImport: false })
  env = {
    WIREMOCK_URL: wm.url,
    WIREMOCK_ADMIN_USER: wm.user,
    WIREMOCK_ADMIN_PASSWORD: wm.password,
    STORE_DRIVER: 'none',
    ADMIN_USER: 'ui-admin',
    ADMIN_PASSWORD: 'ui-admin-pass',
    SESSION_SECRET: 'x',
    SEED_PATH: resolve('tests/fixtures/bundle'),
    // Would delete the baseline stub above (not in the seed) from the user's WireMock: ignored in this mode.
    SEED_PRUNE: 'true',
    TRUST_PROXY: 'true',
  }
  const warn = vi.spyOn(logger, 'warn')
  rt = await bootRuntime(env)
  seedPruneWarned = warn.mock.calls.some(([, msg]) => msg === 'SEED_PRUNE is ignored in WireMock-only mode')
  warn.mockRestore()
}, 120_000)

afterAll(async () => {
  await wm?.stop().catch(() => {})
})

test('boot starts no sync and deletes nothing; the list shows WireMock\'s stubs (not the marker) as editable mocks', async () => {
  expect(rt.reconciler).toBeNull()
  expect(await client.getStub(MARKER_ID)).not.toBeNull()
  const listed = (await (await listMocks(rt, req('/api/mocks', 'GET', undefined, auth))).json()) as StubMapping[]
  // The seed's mock went into WireMock too.
  expect(ids(listed)).toEqual(expect.arrayContaining([uid(1), uid(2), uid(3)]))
  expect(listed.some((s) => s.id === MARKER_ID)).toBe(false)
  expect(listed.find((s) => s.id === uid(1))?.metadata?.wiremockUi).toMatchObject({ owner: 'wiremock', version: 1 })
  const one = await getMock(rt, req(`/api/mocks/${uid(1)}`, 'GET', undefined, auth), { id: uid(1) })
  expect((await one.json()).name).toBe('own 1')
})

test('an edit goes straight to WireMock with the version check; a stale version is 409; create and delete work', async () => {
  const s = await login(rt, 'ui-admin', 'ui-admin-pass')
  const as = { Cookie: s.cookie, 'X-CSRF-Token': s.csrf }
  const stub = { name: 'own 2 edited', request: { method: 'GET', urlPath: '/two' }, response: { status: 201, body: 'edited' } }
  const res = await updateMock(rt, req(`/api/mocks/${uid(2)}`, 'PUT', { stub, version: 1 }, as), { id: uid(2) })
  expect(res.status).toBe(200)
  const saved = await res.json()
  expect(saved.metadata.wiremockUi).toMatchObject({ owner: 'wiremock', version: 2, updatedBy: 'ui-admin' })
  // The response says what was stored: the stub stays persistent in WireMock.
  expect(saved.persistent).toBe(true)
  const served = await fetch(`${wm.url}/two`)
  expect([served.status, await served.text()]).toEqual([201, 'edited'])
  expect((await client.getStub(uid(2)))?.persistent).toBe(true)
  const stale = await updateMock(rt, req(`/api/mocks/${uid(2)}`, 'PUT', { stub, version: 1 }, as), { id: uid(2) })
  expect(stale.status).toBe(409)

  const created = await createMock(rt, req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/new' }, response: { status: 200, body: 'new' } }, as))
  expect(created.status).toBe(201)
  const { id } = await created.json()
  expect(await (await fetch(`${wm.url}/new`)).text()).toBe('new')
  expect((await deleteMock(rt, req(`/api/mocks/${id}?version=1`, 'DELETE', undefined, as), { id })).status).toBe(204)
  expect(await client.getStub(id)).toBeNull()
  // Nothing else was touched.
  for (const n of [1, 2, 3]) expect(await client.getStub(uid(n))).not.toBeNull()

  const entries = (await rt.audit.list()).entries.map((e) => e.action)
  expect(entries).toEqual(expect.arrayContaining(['mock.update', 'mock.create', 'mock.delete']))
})

test('no history, so nothing to restore', async () => {
  const hist = await mockHistory(rt, req(`/api/mocks/${uid(2)}/history`, 'GET', undefined, auth), { id: uid(2) })
  expect(await hist.json()).toEqual([])
  expect((await restoreMock(rt, req(`/api/mocks/${uid(2)}/restore`, 'POST', { version: 1 }, auth), { id: uid(2) })).status).toBe(404)
})

test('only the bootstrap account exists; creating, changing or deleting accounts is 400', async () => {
  const users = await (await listUsers(rt, req('/api/users', 'GET', undefined, auth))).json()
  expect(users.map((u: { username: string }) => u.username)).toEqual(['ui-admin'])
  const id = users[0].id
  const refused = [
    await createUser(rt, req('/api/users', 'POST', { username: 'second', password: 'password-1' }, auth)),
    await updateUser(rt, req(`/api/users/${id}`, 'PATCH', { displayName: 'Root' }, auth), { id }),
    await deleteUser(rt, req(`/api/users/${id}`, 'DELETE', undefined, auth), { id }),
    await changePassword(rt, req('/api/session/password', 'POST', { current: 'ui-admin-pass', next: 'password-2' }, auth)),
  ]
  for (const res of refused) {
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: NO_USER_MANAGEMENT })
  }
})

test('the catalog is seeded from SEED_PATH into memory; healthz is up without a sync time', async () => {
  expect((await rt.catalog.listIntegrations()).map((i) => i.key)).toEqual(['seedpay'])
  const res = await healthz(rt, new Request('http://ui.test/healthz'))
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ store: 'ok', wiremock: 'ok', lastSyncAt: null, lastSyncError: null })
})

test('an import with prune is refused (it would delete stubs from the user\'s WireMock)', async () => {
  const res = await runImport(rt, req('/api/import?prune=true', 'POST', { mocks: [own(8, '/pruned-import')] }, auth))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Prune is not available in WireMock-only mode' })
  expect(await client.getStub(uid(8))).toBeNull()
})

test('an import writes into WireMock without touching other stubs', async () => {
  const bundle = { mocks: [own(7, '/imported')] }
  const res = await runImport(rt, req('/api/import', 'POST', bundle, auth))
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ created: 1 })
  expect(await (await fetch(`${wm.url}/imported`)).text()).toBe('own-7')
  for (const n of [1, 2, 3]) expect(await client.getStub(uid(n))).not.toBeNull()
})

test('a restarted UI finds the same mocks in WireMock (and nothing deleted)', async () => {
  const before = ids(await client.listStubs())
  const again = await bootRuntime(env)
  expect(ids(await client.listStubs())).toEqual(before)
  expect(ids(await again.store.listAll())).toEqual(before.filter((id) => id !== MARKER_ID))
  await again.stores.close()
})

test("SEED_PRUNE is ignored with a warning: nothing is deleted from the user's WireMock", async () => {
  expect(seedPruneWarned).toBe(true)
  expect(await client.getStub(uid(4))).not.toBeNull()
  expect(await (await fetch(`${wm.url}/old-baseline`)).text()).toBe('own-4')
})
