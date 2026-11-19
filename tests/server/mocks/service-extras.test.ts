import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import type { AuditEntry, AuditLog } from '../../../src/server/audit/log'
import { AppError, ConflictError, NotFoundError } from '../../../src/server/errors'
import { MockService, type MockInput } from '../../../src/server/mocks/service'
import { RedisMockStore } from '../../../src/server/store/redis'
import type { PublicUser } from '../../../src/server/users/types'
import { WireMockClient } from '../../../src/server/wiremock/client'
import { startRedis, startWireMock } from '../../helpers/containers'

let wm: Awaited<ReturnType<typeof startWireMock>>
let redisHandle: Awaited<ReturnType<typeof startRedis>>
let store: RedisMockStore
let redis: Redis
let svc: MockService
let entries: Omit<AuditEntry, 'at'>[]
const audit: AuditLog = {
  record: async (e) => {
    entries.push(e)
  },
  list: async () => [],
}
const user = (username: string, role: PublicUser['role'] = 'tester'): PublicUser => ({
  id: username, username, displayName: username, role, disabled: false, createdAt: '', updatedAt: '',
})
const input = (path: string, status = 200, extra: Partial<MockInput> = {}): MockInput => ({
  request: { method: 'GET', urlPath: path },
  response: { status, body: `s${status}` },
  ...extra,
})
const served = async (path: string) => {
  const res = await fetch(`${wm.url}${path}`)
  return { status: res.status, body: await res.text() }
}

beforeAll(async () => {
  wm = await startWireMock()
  redisHandle = await startRedis()
  store = new RedisMockStore(redisHandle.url)
  redis = new Redis(redisHandle.url)
  const client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
  svc = new MockService({ audit, wiremock: client, store })
})

afterAll(async () => {
  await store?.close()
  await redis?.quit()
  await redisHandle?.stop()
  await wm?.stop()
})

beforeEach(async () => {
  entries = []
  await redis.flushdb()
  const res = await fetch(`${wm.url}/__admin/mappings`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${Buffer.from(`${wm.user}:${wm.password}`).toString('base64')}` },
  })
  if (!res.ok) throw new Error(`clear failed: ${res.status}`)
})

async function seedBaseline(path: string, name?: string) {
  const stub = {
    id: crypto.randomUUID(),
    persistent: false,
    name,
    ...input(path),
    metadata: { wiremockUi: { owner: 'baseline', version: 1, updatedAt: new Date().toISOString(), updatedBy: 'baseline', source: 'seed' as const } },
  }
  await store.save(stub, 0)
  await new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password }).importStubs([stub], { deleteAllNotInImport: false })
  return stub
}

test('filters: status, q over name/url/body, owner', async () => {
  const a = await svc.create({ ...input('/orders/list', 200), name: 'Order List' }, user('amy'))
  const b = await svc.create(input('/pay', 500, { request: { method: 'POST', urlPath: '/pay', bodyPatterns: [{ contains: 'Needle' }] } }), user('bob'))
  const c = await svc.create({ request: { method: 'GET', url: '/legacy' }, response: { body: 'no status' } }, user('amy'))
  const ids = async (f: Parameters<MockService['list']>[0]) => (await svc.list(f)).map((s) => s.id).sort()

  expect(await ids({ status: 500 })).toEqual([b.id])
  expect(await ids({ status: 200 })).toEqual([a.id, c.id].sort())
  expect(await ids({ q: 'ORDER' })).toEqual([a.id])
  expect(await ids({ q: 'legacy' })).toEqual([c.id])
  expect(await ids({ q: 'needle' })).toEqual([b.id])
  expect(await ids({ q: '   ' })).toHaveLength(3)
  expect(await ids({ owner: 'amy', q: 'pay' })).toEqual([])
  expect(await ids({ owner: 'amy' })).toEqual([a.id, c.id].sort())
})

test('duplicate a baseline mock as a tester: new id, owner tester, served, name ends " (copy)"', async () => {
  const base = await seedBaseline('/dup/base', 'Base mock')
  const copy = await svc.duplicate(base.id, user('tess'))
  expect(copy.id).not.toBe(base.id)
  expect(copy.name).toBe('Base mock (copy)')
  expect(copy.metadata?.wiremockUi).toMatchObject({ owner: 'tess', version: 1, updatedBy: 'tess' })
  expect(await store.get(copy.id)).toEqual(copy)
  expect(await store.get(base.id)).toMatchObject({ name: 'Base mock' })
  expect(entries.at(-1)).toMatchObject({ action: 'mock.duplicate', target: copy.id, actor: 'tess' })
  await expect(svc.duplicate('missing', user('tess'))).rejects.toBeInstanceOf(NotFoundError)
})

test("reset-mine deletes only the caller's mocks from store and WireMock", async () => {
  await svc.create(input('/rm/a1'), user('amy'))
  await svc.create(input('/rm/a2'), user('amy'))
  const bob = await svc.create(input('/rm/b1'), user('bob'))
  const base = await seedBaseline('/rm/base')
  expect(await svc.resetMine(user('amy'))).toEqual({ deleted: 2 })
  expect((await svc.list()).map((s) => s.id).sort()).toEqual([bob.id, base.id].sort())
  expect((await served('/rm/a1')).status).toBe(404)
  expect((await served('/rm/a2')).status).toBe(404)
  expect((await served('/rm/b1')).status).toBe(200)
  expect((await served('/rm/base')).status).toBe(200)
  expect(entries.at(-1)).toMatchObject({ action: 'mock.reset-mine', actor: 'amy', details: { deleted: 2 } })
  expect(await svc.resetMine(user('amy'))).toEqual({ deleted: 0 })
})

test('history lists previous versions newest first, also after delete', async () => {
  const m = await svc.create(input('/h', 200), user('amy'))
  await svc.update(m.id, input('/h', 201), 1, user('amy'))
  await svc.update(m.id, input('/h', 202), 2, user('amy'))
  const versions = (h: Awaited<ReturnType<MockService['history']>>) => h.map((s) => s.metadata?.wiremockUi?.version)
  expect(versions(await svc.history(m.id))).toEqual([2, 1])
  await svc.delete(m.id, undefined, user('amy'))
  expect(versions(await svc.history(m.id))).toEqual([3, 2, 1])
})

test('restore an older version: becomes the next version and WireMock serves it', async () => {
  const m = await svc.create(input('/r', 200), user('amy'))
  await svc.update(m.id, input('/r', 201), 1, user('amy'))
  const restored = await svc.restore(m.id, 1, user('amy'))
  expect(restored.metadata?.wiremockUi).toMatchObject({ version: 3, owner: 'amy', updatedBy: 'amy' })
  expect(restored.response.status).toBe(200)
  expect(await store.get(m.id)).toEqual(restored)
  expect((await served('/r')).body).toBe('s200')
  expect(entries.at(-1)).toMatchObject({ action: 'mock.restore', target: m.id, details: { fromVersion: 1 } })
  await expect(svc.restore(m.id, 99, user('amy'))).rejects.toMatchObject({ status: 404, message: 'Version not found' })
})

test('restore a deleted mock recreates it with the same id and the next version', async () => {
  const m = await svc.create(input('/rd', 200), user('amy'))
  await svc.update(m.id, input('/rd', 201), 1, user('amy'))
  await svc.delete(m.id, undefined, user('amy'))
  expect((await served('/rd')).status).toBe(404)
  const back = await svc.restore(m.id, 1, user('amy'))
  expect(back.id).toBe(m.id)
  expect(back.metadata?.wiremockUi).toMatchObject({ version: 3, owner: 'amy' })
  expect((await served('/rd')).body).toBe('s200')
  expect(await store.get(m.id)).toEqual(back)
})

test("tester cannot restore a colleague's mock; developer can", async () => {
  const m = await svc.create(input('/rc', 200), user('amy'))
  await svc.update(m.id, input('/rc', 201), 1, user('amy'))
  const err = await svc.restore(m.id, 1, user('bob')).catch((e) => e)
  expect(err).toBeInstanceOf(AppError)
  expect(err.status).toBe(403)
  expect((await served('/rc')).body).toBe('s201')
  expect((await svc.restore(m.id, 1, user('dev', 'developer'))).metadata?.wiremockUi?.version).toBe(3)
})

test('restore of a live mock now owned by someone else is 403 and changes nothing', async () => {
  const m = await svc.create(input('/ro', 200), user('amy'))
  // Current version is owned by bob (set up directly, bypassing the service).
  const current = {
    ...m,
    response: { status: 203, body: 's203' },
    metadata: { wiremockUi: { ...m.metadata!.wiremockUi!, owner: 'bob', version: 2 } },
  }
  await store.save(current, 1)
  await new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password }).importStubs([current], { deleteAllNotInImport: false })
  const err = await svc.restore(m.id, 1, user('amy')).catch((e) => e)
  expect(err.status).toBe(403)
  expect(await store.get(m.id)).toEqual(current)
  expect((await served('/ro')).body).toBe('s203')
})

test('restore of a live mock that moved meanwhile is 409', async () => {
  const m = await svc.create(input('/rs', 200), user('amy'))
  await svc.update(m.id, input('/rs', 201), 1, user('amy'))
  await svc.update(m.id, input('/rs', 202), 2, user('amy'))
  const stale = await store.get(m.id)
  await svc.update(m.id, input('/rs', 203), 3, user('amy'))
  // The restore reads version 3 but the mock is already at 4.
  const racing = new MockService({
    audit,
    wiremock: new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password }),
    store: Object.assign(Object.create(store), { get: async () => stale }),
  })
  const err = await racing.restore(m.id, 1, user('amy')).catch((e) => e)
  expect(err).toBeInstanceOf(ConflictError)
  expect((await store.get(m.id))?.metadata?.wiremockUi?.version).toBe(4)
  expect((await served('/rs')).body).toBe('s203')
})
