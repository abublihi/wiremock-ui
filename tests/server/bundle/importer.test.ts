import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { deterministicId, importBundle } from '../../../src/server/bundle/importer'
import { emptyBundle, type Bundle } from '../../../src/server/bundle/parse'
import { ValidationError } from '../../../src/server/errors'
import type { PublicUser } from '../../../src/server/users/types'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
const admin: PublicUser = {
  id: 'ui-admin',
  username: 'ui-admin',
  displayName: 'a',
  role: 'admin',
  disabled: false,
  createdAt: '',
  updatedAt: '',
}

beforeAll(async () => {
  env = await startTestRuntime()
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

beforeEach(async () => {
  for (const s of await env.rt.store.listAll()) await env.rt.mocks.deleteImported(s.id)
  for (const i of await env.rt.catalog.listIntegrations()) await env.rt.stores.catalog.deleteIntegration(i.key)
})

const deps = () => ({ catalog: env.rt.catalog, mocks: env.rt.mocks, store: env.rt.store, audit: env.rt.audit })
const run = (b: Partial<Bundle>, prune = false, actor = 'ui-admin') =>
  importBundle({ ...emptyBundle(), ...b }, deps(), { actor, prune, source: 'import' })
const stub = (path: string, extra: Record<string, unknown> = {}) =>
  ({ request: { method: 'GET', urlPath: path }, response: { status: 200, body: path }, ...extra }) as unknown as StubMapping
const serve = async (path: string) => {
  const res = await fetch(`${env.wm.url}${path}`)
  return res.status === 200 ? res.text() : res.status
}

test('creates baseline mocks served by WireMock', async () => {
  const r = await run({ mocks: [stub('/imp/a', { id: '00000000-0000-4000-8000-0000000000a1' })] })
  expect(r).toMatchObject({ created: 1, updated: 0, unchanged: 0, pruned: 0 })
  const stored = await env.rt.store.get('00000000-0000-4000-8000-0000000000a1')
  expect(stored?.metadata?.wiremockUi).toMatchObject({ owner: 'baseline', source: 'import', version: 1, updatedBy: 'ui-admin' })
  expect(stored?.persistent).toBe(false)
  expect(await serve('/imp/a')).toBe('/imp/a')
})

test('re-import is unchanged (no version bump); changed stub bumps version', async () => {
  const id = '00000000-0000-4000-8000-0000000000b1'
  await run({ mocks: [stub('/imp/b', { id })] })
  expect((await run({ mocks: [stub('/imp/b', { id })] })).unchanged).toBe(1)
  expect((await env.rt.store.get(id))?.metadata?.wiremockUi?.version).toBe(1)
  const changed = { ...stub('/imp/b', { id }), response: { status: 201, body: 'new' } }
  expect((await run({ mocks: [changed] })).updated).toBe(1)
  expect((await env.rt.store.get(id))?.metadata?.wiremockUi?.version).toBe(2)
})

test('never touches person-owned mocks', async () => {
  await env.rt.mocks.create({ request: { method: 'GET', urlPath: '/imp/c' }, response: { status: 200, body: 'mine' } }, { ...admin, username: 'alice' })
  const [mine] = await env.rt.mocks.list({ owner: 'alice' })
  const r = await run({ mocks: [{ ...stub('/imp/c-new'), id: mine.id }] }, true)
  expect(r.skipped).toEqual([{ id: mine.id, reason: 'owned by alice' }])
  expect(r.pruned).toBe(0)
  expect((await env.rt.store.get(mine.id))?.response.body).toBe('mine')
})

test('imported plain stub is editable', async () => {
  const id = '00000000-0000-4000-8000-0000000000d1'
  await run({ mocks: [stub('/imp/d', { id })] })
  const updated = await env.rt.mocks.update(id, { request: { method: 'GET', urlPath: '/imp/d' }, response: { status: 200, body: 'edited' } }, 1, admin)
  expect(updated.metadata?.wiremockUi?.version).toBe(2)
})

test('deterministic id for id-less stubs', async () => {
  const a = await run({ mocks: [stub('/imp/e')] })
  const b = await run({ mocks: [stub('/imp/e')] })
  expect(a.created).toBe(1)
  expect(b.unchanged).toBe(1)
  const id = deterministicId(stub('/imp/e'))
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(await env.rt.store.get(id)).not.toBeNull()
  expect(deterministicId({ ...stub('/imp/e'), id: 'x', metadata: { wiremockUi: { owner: 'z' } } })).toBe(id)
})

test('prune removes only baseline mocks missing from the bundle', async () => {
  await run({ mocks: [stub('/imp/p1', { id: '00000000-0000-4000-8000-0000000000f1' }), stub('/imp/p2', { id: '00000000-0000-4000-8000-0000000000f2' })] })
  await env.rt.mocks.create(stub('/imp/p-mine'), { ...admin, username: 'bob' })
  const r = await run({ mocks: [stub('/imp/p1', { id: '00000000-0000-4000-8000-0000000000f1' })] }, true)
  expect(r.pruned).toBe(1)
  expect(await env.rt.store.get('00000000-0000-4000-8000-0000000000f2')).toBeNull()
  expect(await serve('/imp/p2')).toBe(404)
  expect(await env.rt.mocks.list({ owner: 'bob' })).toHaveLength(1)
})

test('integration guessed from prefix (longest wins)', async () => {
  const r = await run({
    integrations: [
      { key: 'pay', name: 'Pay', prefix: '/pay' },
      { key: 'pay-v2', name: 'Pay v2', prefix: '/pay/v2' },
    ],
    mocks: [stub('/pay/v2/x', { id: '00000000-0000-4000-8000-000000000a01' }), stub('/pay/y', { id: '00000000-0000-4000-8000-000000000a02' })],
  })
  expect(r).toMatchObject({ integrations: 2, created: 2 })
  expect((await env.rt.store.get('00000000-0000-4000-8000-000000000a01'))?.metadata?.wiremockUi?.integration).toBe('pay-v2')
  expect((await env.rt.store.get('00000000-0000-4000-8000-000000000a02'))?.metadata?.wiremockUi?.integration).toBe('pay')
})

test('invalid entries abort before any write', async () => {
  const good = { key: 'ok1', name: 'Ok', prefix: '/ok' }
  await expect(
    run({ integrations: [good, { key: 'BAD KEY', name: 'x', prefix: '/x' }], mocks: [stub('/imp/z')] }),
  ).rejects.toThrow(/integrations\[1\] \(BAD KEY\)/)
  await expect(run({ integrations: [good], mocks: [{ request: {}, response: { bodyFileName: 'f' } } as unknown as StubMapping] })).rejects.toThrow(ValidationError)
  expect(await env.rt.catalog.listIntegrations()).toEqual([])
  expect(await env.rt.store.listAll()).toEqual([])
})

test('counts ignored oidc identities and audits one import entry', async () => {
  const r = await run({ oidcIdentities: [{}, {}] })
  expect(r.ignoredOidcIdentities).toBe(2)
  expect((await env.rt.audit.list({ limit: 1 })).entries[0]).toMatchObject({ action: 'import', actor: 'ui-admin' })
})

test('metadata that is not an object is rejected before any write', async () => {
  await expect(
    run({ integrations: [{ key: 'm1', name: 'M', prefix: '/m' }], mocks: [stub('/imp/m', { metadata: 'x' })] }),
  ).rejects.toThrow(/mocks\[0\].*metadata must be an object/)
  expect(await env.rt.catalog.listIntegrations()).toEqual([])
})

test('prune is skipped when the seed had unreadable entries', async () => {
  await run({ mocks: [stub('/imp/u1', { id: '00000000-0000-4000-8000-0000000000e1' })] })
  const r = await importBundle(emptyBundle(), deps(), { actor: 'system', prune: true, source: 'seed', unreadable: 1 })
  expect(r.pruned).toBe(0)
  expect(await env.rt.store.get('00000000-0000-4000-8000-0000000000e1')).not.toBeNull()
})

test('re-importing the same catalog writes nothing and reports only changed entries', async () => {
  const integration = { key: 'idem', name: 'Idem', prefix: '/idem' }
  const endpoint = {
    integration: 'idem', key: 'get', name: 'Get', method: 'GET', path: '/x', pathType: 'exact',
    contentType: 'json', exampleResponses: {}, allowedStatuses: [],
  }
  expect(await run({ integrations: [integration], catalog: [endpoint] })).toMatchObject({ integrations: 1, endpoints: 1 })
  const before = (await env.rt.audit.list({ limit: 500 })).entries.filter((e) => e.action.startsWith('catalog.')).length
  const stored = await env.rt.catalog.getEndpoint('idem', 'get')
  expect(await run({ integrations: [integration], catalog: [endpoint] }, false, 'someone-else')).toMatchObject({ integrations: 0, endpoints: 0 })
  const after = (await env.rt.audit.list({ limit: 500 })).entries.filter((e) => e.action.startsWith('catalog.')).length
  expect(after).toBe(before)
  expect(await env.rt.catalog.getEndpoint('idem', 'get')).toEqual(stored)
  expect(await run({ integrations: [integration], catalog: [{ ...endpoint, name: 'Get v2' }] })).toMatchObject({ integrations: 0, endpoints: 1 })
  expect((await env.rt.catalog.getEndpoint('idem', 'get')).name).toBe('Get v2')
})
