import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { ConflictError, NotFoundError, ValidationError } from '../../../src/server/errors'
import { MockService, type MockInput } from '../../../src/server/mocks/service'
import { RedisMockStore } from '../../../src/server/store/redis'
import type { MockStore } from '../../../src/server/store/types'
import { WireMockClient } from '../../../src/server/wiremock/client'
import { startRedis, startWireMock } from '../../helpers/containers'

let wm: Awaited<ReturnType<typeof startWireMock>>
let redisHandle: Awaited<ReturnType<typeof startRedis>>
let store: RedisMockStore
let redis: Redis
let client: WireMockClient
let svc: MockService

const auth = () => ({
  Authorization: `Basic ${Buffer.from(`${wm.user}:${wm.password}`).toString('base64')}`,
})

const input = (status: number, extra: Partial<MockInput> = {}): MockInput => ({
  request: { method: 'GET', urlPath: '/t' },
  response: { status, body: `s${status}` },
  ...extra,
})

function failingStore(real: MockStore, fail: 'save' | 'delete' = 'save'): MockStore {
  return {
    get: (id) => real.get(id),
    list: (f) => real.list(f),
    listAll: () => real.listAll(),
    save: async (stub, v) => {
      if (fail === 'save') throw new Error('redis down')
      return real.save(stub, v)
    },
    delete: async (id, v) => {
      if (fail === 'delete') throw new Error('redis down')
      return real.delete(id, v)
    },
    history: (id) => real.history(id),
    acquireLock: (n, t) => real.acquireLock(n, t),
    releaseLock: (n, t) => real.releaseLock(n, t),
    ping: () => real.ping(),
    close: () => real.close(),
  }
}

beforeAll(async () => {
  wm = await startWireMock()
  redisHandle = await startRedis()
  store = new RedisMockStore(redisHandle.url)
  redis = new Redis(redisHandle.url)
  client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
  svc = new MockService({ wiremock: client, store })
})

afterAll(async () => {
  await store?.close()
  await redis?.quit()
  await redisHandle?.stop()
  await wm?.stop()
})

beforeEach(async () => {
  await redis.flushdb()
  const res = await fetch(`${wm.url}/__admin/mappings`, { method: 'DELETE', headers: auth() })
  if (!res.ok) throw new Error(`clear failed: ${res.status}`)
})

test('create stores the stub and WireMock serves it', async () => {
  const m = await svc.create(input(200, { persistent: true }), 'admin')
  expect(m.persistent).toBe(false)
  expect(m.metadata?.wiremockUi).toMatchObject({
    owner: 'admin',
    version: 1,
    updatedBy: 'admin',
    source: 'ui',
  })
  expect(await store.get(m.id)).toEqual(m)
  const res = await fetch(`${wm.url}/t`)
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('s200')
})

test('create keeps integration, endpoint and other metadata keys', async () => {
  const m = await svc.create(
    input(200, { metadata: { wiremockUi: { integration: 'pay', endpoint: '/t' }, note: 'x' } }),
    'admin',
  )
  expect(m.metadata?.wiremockUi).toMatchObject({ integration: 'pay', endpoint: '/t', version: 1 })
  expect(m.metadata?.note).toBe('x')
  expect(await svc.list({ integration: 'pay' })).toHaveLength(1)
})

test('update bumps version, keeps owner, records updatedBy', async () => {
  const m = await svc.create(input(200), 'admin')
  const u = await svc.update(m.id, input(201), 1, 'sara')
  expect(u.id).toBe(m.id)
  expect(u.metadata?.wiremockUi).toMatchObject({ owner: 'admin', version: 2, updatedBy: 'sara' })
  expect((await fetch(`${wm.url}/t`)).status).toBe(201)
  expect(await svc.get(m.id)).toEqual(u)
})

test('update of a missing stub is NotFoundError', async () => {
  await expect(svc.update('nope', input(200), 1, 'a')).rejects.toBeInstanceOf(NotFoundError)
})

test('invalid stub is rejected and nothing is stored', async () => {
  const bad = { request: { method: 'GET', urlPathPattern: '([' }, response: { status: 200 } }
  await expect(svc.create(bad, 'admin')).rejects.toBeInstanceOf(ValidationError)
  expect(await svc.list()).toEqual([])
})

test('bodyFileName is rejected before WireMock is called', async () => {
  let calls = 0
  const spy = new WireMockClient({
    baseUrl: wm.url,
    user: wm.user,
    password: wm.password,
    fetch: (...a) => {
      calls++
      return fetch(...a)
    },
  })
  const s = new MockService({ wiremock: spy, store })
  const err = await s
    .create({ request: { method: 'GET', urlPath: '/f' }, response: { status: 200, bodyFileName: 'a.json' } }, 'admin')
    .catch((e) => e)
  expect(err).toBeInstanceOf(ValidationError)
  expect(err.message).toBe('bodyFileName is not supported; put the body inline')
  expect(calls).toBe(0)
})

test('concurrent edits: second gets ConflictError, WireMock serves the winner', async () => {
  const m = await svc.create(input(200), 'admin')
  await svc.update(m.id, input(201), 1, 'sara')
  let calls = 0
  const spy = new WireMockClient({
    baseUrl: wm.url,
    user: wm.user,
    password: wm.password,
    fetch: (...a) => {
      calls++
      return fetch(...a)
    },
  })
  const stale = new MockService({ wiremock: spy, store })
  await expect(stale.update(m.id, input(202), 1, 'omar')).rejects.toBeInstanceOf(ConflictError)
  expect(calls).toBe(0)
  expect((await fetch(`${wm.url}/t`)).status).toBe(201)
})

test('rolls back create when the store write fails', async () => {
  const s = new MockService({ wiremock: client, store: failingStore(store), newId: () => 'c0000000-0000-4000-8000-000000000001' })
  await expect(s.create(input(200), 'admin')).rejects.toThrow('redis down')
  expect(await client.getStub('c0000000-0000-4000-8000-000000000001')).toBeNull()
})

test('rolls back edit when the store write fails: previous version still served', async () => {
  const m = await svc.create(input(200), 'admin')
  const s = new MockService({ wiremock: client, store: failingStore(store) })
  await expect(s.update(m.id, input(500), 1, 'sara')).rejects.toThrow('redis down')
  expect((await fetch(`${wm.url}/t`)).status).toBe(200)
  const wmStub = await client.getStub(m.id)
  expect(wmStub?.metadata?.wiremockUi?.version).toBe(1)
})

test('delete removes from WireMock and store; second delete is NotFoundError', async () => {
  const m = await svc.create(input(200), 'admin')
  await svc.delete(m.id, 1, 'admin')
  expect(await client.getStub(m.id)).toBeNull()
  expect(await store.get(m.id)).toBeNull()
  expect((await fetch(`${wm.url}/t`)).status).toBe(404)
  await expect(svc.delete(m.id, undefined, 'admin')).rejects.toBeInstanceOf(NotFoundError)
  await expect(svc.get(m.id)).rejects.toBeInstanceOf(NotFoundError)
})

test('delete with stale version is ConflictError and stub still served', async () => {
  const m = await svc.create(input(200), 'admin')
  await svc.update(m.id, input(201), 1, 'sara')
  await expect(svc.delete(m.id, 1, 'omar')).rejects.toBeInstanceOf(ConflictError)
  expect((await fetch(`${wm.url}/t`)).status).toBe(201)
})

test('rolls back delete when the store delete fails: stub still served and stored', async () => {
  const m = await svc.create(input(200), 'admin')
  const s = new MockService({ wiremock: client, store: failingStore(store, 'delete') })
  await expect(s.delete(m.id, 1, 'admin')).rejects.toThrow('redis down')
  expect((await fetch(`${wm.url}/t`)).status).toBe(200)
  expect(await store.get(m.id)).not.toBeNull()
})
