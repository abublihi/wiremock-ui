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
})

const deps = () => ({ mocks: env.rt.mocks, store: env.rt.store, audit: env.rt.audit })
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

test('an old bundle with integrations: its mocks get the integration as a tag, an endpoint with a key becomes one mock with several responses', async () => {
  const id = (n: number) => `00000000-0000-4000-8000-0000000a000${n}`
  const linked = (n: number, request: Record<string, unknown>, priority: number) =>
    ({ id: id(n), name: `Get post ${n}`, priority, request, response: { status: 200, body: String(n) }, metadata: { wiremockUi: { integration: 'blog', endpoint: 'get-post' } } }) as unknown as StubMapping
  const r = await run({
    integrations: [{ key: 'blog', name: 'Blog', prefix: '/blog' }],
    catalog: [{ integration: 'blog', key: 'get-post', name: 'Get post', method: 'GET', path: '/posts/{id}', pathType: 'template', lookup: { location: 'path', expression: 'id' } }],
    mocks: [
      linked(1, { method: 'GET', urlPathTemplate: '/blog/posts/{id}', pathParameters: { id: { equalTo: 'p-1' } } }, 5),
      linked(2, { method: 'GET', urlPathTemplate: '/blog/posts/{id}' }, 10),
      { ...stub('/blog/other', { id: id(3) }), metadata: { wiremockUi: { integration: 'blog' } } } as StubMapping,
    ],
  })
  expect(r).toMatchObject({ created: 3 })
  const [one, fallback, other] = await Promise.all([1, 2, 3].map((n) => env.rt.store.get(id(n))))
  expect(one?.metadata?.wiremockUi).toMatchObject({ tags: ['blog'], group: { id: 'endpoint-blog-get-post', by: [{ location: 'path', expression: 'id' }], values: ['p-1'] } })
  expect(one?.metadata?.wiremockUi?.integration).toBeUndefined()
  expect(fallback?.metadata?.wiremockUi?.group).toMatchObject({ id: 'endpoint-blog-get-post' })
  expect(fallback?.metadata?.wiremockUi?.group?.values).toBeUndefined()
  expect(other?.metadata?.wiremockUi).toMatchObject({ tags: ['blog'] })
  expect(other?.metadata?.wiremockUi?.group).toBeUndefined()
  expect(await serve('/blog/posts/p-1')).toBe('1')
  expect(await serve('/blog/posts/p-9')).toBe('2')
  // Importing the same file again changes nothing.
  expect(await run({ mocks: [linked(1, { method: 'GET', urlPathTemplate: '/blog/posts/{id}', pathParameters: { id: { equalTo: 'p-1' } } }, 5)], catalog: [{ integration: 'blog', key: 'get-post', name: 'Get post', lookup: { location: 'path', expression: 'id' } }] })).toMatchObject({ unchanged: 1 })
})

test('invalid entries abort before any write', async () => {
  await expect(run({ mocks: [stub('/imp/ok'), { request: {}, response: { bodyFileName: 'f' } } as unknown as StubMapping] })).rejects.toThrow(ValidationError)
  expect(await env.rt.store.listAll()).toEqual([])
})

test('counts ignored oidc identities and audits one import entry', async () => {
  const r = await run({ oidcIdentities: [{}, {}] })
  expect(r.ignoredOidcIdentities).toBe(2)
  expect((await env.rt.audit.list({ limit: 1 })).entries[0]).toMatchObject({ action: 'import', actor: 'ui-admin' })
})

test('metadata that is not an object is rejected before any write', async () => {
  await expect(run({ mocks: [stub('/imp/m', { metadata: 'x' })] })).rejects.toThrow(/mocks\[0\].*metadata must be an object/)
  expect(await env.rt.store.listAll()).toEqual([])
})

test('prune is skipped when the seed had unreadable entries', async () => {
  await run({ mocks: [stub('/imp/u1', { id: '00000000-0000-4000-8000-0000000000e1' })] })
  const r = await importBundle(emptyBundle(), deps(), { actor: 'system', prune: true, source: 'seed', unreadable: 1 })
  expect(r.pruned).toBe(0)
  expect(await env.rt.store.get('00000000-0000-4000-8000-0000000000e1')).not.toBeNull()
})

test('a bad webhook in a later mock aborts the import before any mock is written', async () => {
  const good = (n: number) => stub(`/imp/hook-${n}`, { id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}` })
  const bad = stub('/imp/hook-bad', { serveEventListeners: [{ name: 'webhook', parameters: { method: 'POST', url: 'ftp://x.test/cb' } }] })
  await expect(run({ mocks: [good(1), good(2), good(3), good(4), bad] })).rejects.toThrow(/mocks\[4\].*serveEventListeners\[0\]\.parameters\.url must be an http/)
  expect(await env.rt.store.listAll()).toEqual([])
  expect(await serve('/imp/hook-1')).toBe(404)
})

test('tags travel with an import, normalised; changing them updates the mock', async () => {
  const id = '00000000-0000-4000-8000-0000000000d1'
  const tagged = (tags: unknown) => stub('/imp/tags', { id, metadata: { wiremockUi: { tags } } })
  expect((await run({ mocks: [tagged(['Qiwa API', 'qiwa-api', ' ajeer '])] })).created).toBe(1)
  expect((await env.rt.store.get(id))?.metadata?.wiremockUi?.tags).toEqual(['qiwa-api', 'ajeer'])
  expect((await run({ mocks: [tagged(['qiwa-api', 'ajeer'])] })).unchanged).toBe(1)
  expect((await run({ mocks: [tagged(['ajeer'])] })).updated).toBe(1)
  expect((await env.rt.store.get(id))?.metadata?.wiremockUi?.tags).toEqual(['ajeer'])
  await expect(run({ mocks: [tagged(['ok', 'bad/tag'])] })).rejects.toThrow(/mocks\[0\].*"bad\/tag" is not a usable tag/)
  await expect(run({ mocks: [tagged('qiwa')] })).rejects.toThrow(/tags must be a list of strings/)
})

test('a dry run reports each mock\'s outcome and writes nothing', async () => {
  const kept = '00000000-0000-4000-8000-0000000000e1'
  const gone = '00000000-0000-4000-8000-0000000000e3'
  await run({ mocks: [stub('/dry/kept', { id: kept }), stub('/dry/gone', { id: gone })] })
  await env.rt.mocks.create(stub('/dry/mine') as never, admin)
  const personal = (await env.rt.store.list({ owner: 'ui-admin' }))[0]!
  const before = await env.rt.store.listAll()
  const report = await importBundle(
    {
      ...emptyBundle(),
      mocks: [
        stub('/dry/new'),
        stub('/dry/kept', { id: kept }),
        { ...stub('/dry/kept2', { id: kept }), response: { status: 500 } } as StubMapping,
        stub('/dry/mine', { id: personal.id }),
      ],
    },
    deps(),
    { actor: 'ui-admin', prune: true, source: 'import', dryRun: true },
  )
  expect(report).toMatchObject({ created: 1, updated: 1, unchanged: 0, pruned: 1 })
  expect(report.items).toEqual([
    { index: 0, id: deterministicId(stub('/dry/new') as never), outcome: 'created' },
    { index: 2, id: kept, outcome: 'updated' },
    { index: 3, id: personal.id, outcome: 'skipped', reason: 'owned by ui-admin' },
  ])
  expect(await env.rt.store.listAll()).toEqual(before)
})
