import { afterAll, beforeAll, expect, test } from 'vitest'
import { ConflictError, NotFoundError, ValidationError } from '../../../src/server/errors'
import { buildGroupStubs, type GroupInput } from '../../../src/server/mocks/groups'
import type { PublicUser } from '../../../src/server/users/types'
import { startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
const admin: PublicUser = { id: 'ui-admin', username: 'ui-admin', displayName: 'a', disabled: false, createdAt: '', updatedAt: '' }

beforeAll(async () => {
  env = await startTestRuntime()
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

const serve = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${env.wm.url}${path}`, init)
  return `${res.status} ${await res.text()}`
}
const input = (over: Partial<GroupInput> = {}): GroupInput => ({
  name: 'Establishment',
  tags: ['qiwa'],
  request: { method: 'GET', urlType: 'template', url: '/grp/est/{officeId}/seq/{seq}' },
  by: { location: 'path', expression: 'seq' },
  responses: [
    { value: '1', response: { status: 200, body: 'active' } },
    { value: '2', response: { status: 200, body: 'expired' } },
  ],
  fallback: { response: { status: 404, body: 'none' } },
  ...over,
})
const versions = (stubs: { id: string; metadata?: { wiremockUi?: { version?: number } } }[]) =>
  Object.fromEntries(stubs.map((s) => [s.id, s.metadata!.wiremockUi!.version!]))

test('the builder: one stub per value with an equalTo matcher, the fallback last and one step lower', () => {
  const stubs = buildGroupStubs(input({ priority: 3 }), 'g1')
  expect(stubs.map((s) => [s.priority, s.request.pathParameters, s.metadata.wiremockUi.group])).toEqual([
    [3, { seq: { equalTo: '1' } }, { id: 'g1', by: [{ location: 'path', expression: 'seq' }], values: ['1'], order: 0 }],
    [3, { seq: { equalTo: '2' } }, { id: 'g1', by: [{ location: 'path', expression: 'seq' }], values: ['2'], order: 1 }],
    [8, undefined, { id: 'g1', by: [{ location: 'path', expression: 'seq' }], order: 2 }],
  ])
  expect(stubs[0]!.metadata.wiremockUi).toMatchObject({ tags: ['qiwa'] })
  expect(buildGroupStubs(input({ by: { location: 'query', expression: 'lang' } }), 'g').map((s) => s.request.queryParameters)).toEqual([
    { lang: { equalTo: '1' } },
    { lang: { equalTo: '2' } },
    undefined,
  ])
  expect(buildGroupStubs(input({ fallback: null }), 'g')).toHaveLength(2)
})

test('the builder refuses what WireMock could not match as meant', () => {
  const fails = (over: Partial<GroupInput>, message: RegExp) => expect(() => buildGroupStubs(input(over), 'g')).toThrow(message)
  fails({ by: { location: 'path', expression: 'nope' } }, /the URL has no \{nope\}/)
  fails({ request: { method: 'GET', urlType: 'path', url: '/x' } }, /needs a path template URL/)
  fails({ responses: [{ value: '1', response: { status: 200 } }, { value: '1', response: { status: 201 } }] }, /another response has the same values/)
  fails({ responses: [{ value: '', response: { status: 200 } }] }, /values must not be empty/)
  fails({ by: { location: 'header', expression: ' ' } }, /by.expression is required/)
})

test('a group is served by WireMock value by value; editing keeps, adds and removes stubs; deleting removes all', async () => {
  const created = await env.rt.mocks.saveGroup(undefined, input(), {}, admin)
  expect(created).toHaveLength(3)
  const id = created[0]!.metadata!.wiremockUi!.group!.id
  expect(await serve('/grp/est/2/seq/1')).toBe('200 active')
  expect(await serve('/grp/est/9/seq/2')).toBe('200 expired')
  expect(await serve('/grp/est/2/seq/7')).toBe('404 none')

  // Change 2, drop 1, add 3; the fallback stays.
  const next = input({ responses: [{ value: '2', response: { status: 200, body: 'renewed' } }, { value: '3', response: { status: 201, body: 'new' } }] })
  const updated = await env.rt.mocks.saveGroup(id, next, versions(created), admin)
  expect(updated.map((s) => s.metadata!.wiremockUi!.group!.values)).toEqual([['2'], ['3'], undefined])
  expect(updated[0]!.id).toBe(created[1]!.id)
  expect(updated[0]!.metadata!.wiremockUi!.version).toBe(2)
  expect(updated[2]!.id).toBe(created[2]!.id)
  expect(await env.rt.store.get(created[0]!.id)).toBeNull()
  expect(await serve('/grp/est/2/seq/1')).toBe('404 none')
  expect(await serve('/grp/est/2/seq/2')).toBe('200 renewed')
  expect(await serve('/grp/est/2/seq/3')).toBe('201 new')
  expect((await env.rt.mocks.getGroup(id)).map((s) => s.id)).toEqual(updated.map((s) => s.id))

  // A stale editor is refused, and nothing changes.
  await expect(env.rt.mocks.saveGroup(id, input(), versions(created), admin)).rejects.toBeInstanceOf(ConflictError)
  expect(await serve('/grp/est/2/seq/3')).toBe('201 new')

  // Without a fallback, other values fall through to WireMock's 404.
  const noFallback = await env.rt.mocks.saveGroup(id, { ...next, fallback: null }, versions(updated), admin)
  expect(noFallback).toHaveLength(2)
  expect((await fetch(`${env.wm.url}/grp/est/2/seq/9`)).status).toBe(404)

  await env.rt.mocks.deleteGroup(id, admin)
  await expect(env.rt.mocks.getGroup(id)).rejects.toBeInstanceOf(NotFoundError)
  expect((await fetch(`${env.wm.url}/grp/est/2/seq/2`)).status).toBe(404)
})

test('a single mock grows into a group under its own id (replaces); a stale version is refused', async () => {
  const single = await env.rt.mocks.create({ name: 'one', request: { method: 'GET', urlPathTemplate: '/grp/r/{id}' }, response: { status: 200, body: 'old' } }, admin)
  const grown = input({ request: { method: 'GET', urlType: 'template', url: '/grp/r/{id}' }, by: { location: 'path', expression: 'id' }, fallback: null })
  await expect(env.rt.mocks.saveGroup(undefined, grown, {}, admin, { id: single.id, version: 9 })).rejects.toBeInstanceOf(ConflictError)
  const stubs = await env.rt.mocks.saveGroup(undefined, grown, {}, admin, { id: single.id, version: 1 })
  // Without "every other request", the first response takes the mock's id.
  expect(stubs[0]!.id).toBe(single.id)
  expect(stubs[0]!.metadata!.wiremockUi!.version).toBe(2)
  expect(await serve('/grp/r/1')).toBe('200 active')
  // Duplicating one response makes a mock of its own.
  const copy = await env.rt.mocks.duplicate(stubs[1]!.id, admin)
  expect(copy.metadata!.wiremockUi!.group).toBeUndefined()
  await expect(env.rt.mocks.saveGroup(undefined, grown, {}, admin, { id: stubs[1]!.id, version: 1 })).rejects.toBeInstanceOf(ValidationError)
})

test('the mock list folds a group into one row', async () => {
  const stubs = await env.rt.mocks.saveGroup(undefined, input({ request: { method: 'GET', urlType: 'template', url: '/grp/fold/{seq}' } }), {}, admin)
  const page = await env.rt.mocks.listPage({ q: '/grp/fold/' }, { limit: 10, offset: 0 })
  expect(page).toMatchObject({ total: 1, totalMocks: 3 })
  expect(page.items.map((s) => s.id).sort()).toEqual(stubs.map((s) => s.id).sort())
})

test('several conditions: a response matches all its values; one left at any value sits below the specific ones', () => {
  const stubs = buildGroupStubs(
    input({
      by: [
        { location: 'path', expression: 'seq' },
        { location: 'header', expression: 'X-Tenant' },
      ],
      responses: [
        { values: ['1', 'acme'], response: { status: 409, body: 'acme' } },
        { values: ['1', null], response: { status: 200, body: 'any tenant' } },
      ],
    }),
    'g',
  )
  expect(stubs.map((s) => [s.priority, s.request.pathParameters, s.request.headers, s.metadata.wiremockUi.group?.values])).toEqual([
    [undefined, { seq: { equalTo: '1' } }, { 'X-Tenant': { equalTo: 'acme' } }, ['1', 'acme']],
    [6, { seq: { equalTo: '1' } }, undefined, ['1', null]],
    [10, undefined, undefined, undefined],
  ])
  const fails = (over: Partial<GroupInput>, message: RegExp) => expect(() => buildGroupStubs(input(over), 'g')).toThrow(message)
  const two = [
    { location: 'path' as const, expression: 'seq' },
    { location: 'header' as const, expression: 'x-tenant' },
  ]
  fails({ by: two, responses: [{ values: ['1'], response: { status: 200 } }] }, /one value per condition/)
  fails({ by: two, responses: [{ values: [null, null], response: { status: 200 } }] }, /at least one value/)
  fails({ by: [...two, { location: 'header', expression: 'X-TENANT' }] }, /the same condition is there twice/)
})

test('a webhook per response; with no responses left the mock is saved as a plain mock', async () => {
  const [hooked] = buildGroupStubs(
    input({ responses: [{ value: '1', response: { status: 200, webhook: { method: 'POST', url: 'http://example.test/hook' } } }] }),
    'g',
  )
  expect(hooked!.serveEventListeners).toEqual([{ name: 'webhook', parameters: { method: 'POST', url: 'http://example.test/hook' } }])

  const created = await env.rt.mocks.saveGroup(undefined, input({ request: { method: 'GET', urlType: 'template', url: '/grp/plain/{seq}' } }), {}, admin)
  const id = created[0]!.metadata!.wiremockUi!.group!.id
  const plain = await env.rt.mocks.saveGroup(
    id,
    input({ request: { method: 'GET', urlType: 'template', url: '/grp/plain/{seq}' }, responses: [], priority: 2 }),
    versions(created),
    admin,
  )
  expect(plain).toHaveLength(1)
  expect(plain[0]!.id).toBe(created[2]!.id)
  expect(plain[0]!.metadata!.wiremockUi!.group).toBeUndefined()
  expect(plain[0]!.priority).toBe(2)
  expect(await serve('/grp/plain/1')).toBe('404 none')
  await expect(env.rt.mocks.getGroup(id)).rejects.toBeInstanceOf(NotFoundError)
  expect(() => buildGroupStubs(input({ responses: [], fallback: null }), 'g')).toThrow(/at least one response/)
})

test('a group saved in the older one-condition shape still reads, and saving it again keeps each stub', async () => {
  const [a, b] = buildGroupStubs(input({ request: { method: 'GET', urlType: 'template', url: '/grp/old/{seq}' }, fallback: null }), 'old-g')
  const legacy = (s: typeof a, value: string) => ({
    ...s!,
    metadata: { wiremockUi: { group: { id: 'old-g', by: { location: 'path', expression: 'seq' }, value, order: 0 } } },
  })
  const one = await env.rt.mocks.create(legacy(a, '1') as never, admin)
  const two = await env.rt.mocks.create(legacy(b, '2') as never, admin)
  const group = await env.rt.mocks.getGroup('old-g')
  expect(group.map((s) => s.id).sort()).toEqual([one.id, two.id].sort())
  const saved = await env.rt.mocks.saveGroup('old-g', input({ request: { method: 'GET', urlType: 'template', url: '/grp/old/{seq}' }, fallback: null }), versions(group), admin)
  expect(saved.map((s) => s.id)).toEqual([one.id, two.id])
  expect(saved[0]!.metadata!.wiremockUi!.group).toEqual({ id: 'old-g', by: [{ location: 'path', expression: 'seq' }], values: ['1'], order: 0 })
})
