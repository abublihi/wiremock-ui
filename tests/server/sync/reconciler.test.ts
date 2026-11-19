import { Redis } from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { MARKER_ID, markerStub } from '../../../src/server/sync/marker'
import { Reconciler } from '../../../src/server/sync/reconciler'
import { RedisMockStore } from '../../../src/server/store/redis'
import type { MockStore } from '../../../src/server/store/types'
import { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startRedis, startWireMock } from '../../helpers/containers'

let wm: Awaited<ReturnType<typeof startWireMock>>
let redisHandle: Awaited<ReturnType<typeof startRedis>>
let store: RedisMockStore
let redis: Redis
let client: WireMockClient
const reconcilers: Reconciler[] = []

const mk = (opts: { wiremock?: WireMockClient; store?: MockStore; intervalMs?: number } = {}) => {
  const r = new Reconciler({
    wiremock: opts.wiremock ?? client,
    store: opts.store ?? store,
    intervalMs: opts.intervalMs ?? 60_000,
  })
  reconcilers.push(r)
  return r
}

const stubOf = (id: string, path = `/s/${id}`): StubMapping => ({
  id,
  persistent: false,
  request: { method: 'GET', urlPath: path },
  response: { status: 200, body: id },
  metadata: {
    wiremockUi: { owner: 'sara', version: 1, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'sara', source: 'ui' },
  },
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function fill(n: number) {
  const ids = Array.from({ length: n }, (_, i) => uuid(i + 1))
  for (let i = 0; i < ids.length; i += 100) {
    await Promise.all(ids.slice(i, i + 100).map((id) => store.save(stubOf(id), 0)))
  }
  return ids
}

async function until(fn: () => Promise<boolean>, ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return fn()
}

beforeAll(async () => {
  wm = await startWireMock()
  redisHandle = await startRedis()
  store = new RedisMockStore(redisHandle.url)
  redis = new Redis(redisHandle.url)
  client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
}, 120_000)

afterAll(async () => {
  await store?.close()
  await redis?.quit()
  await redisHandle?.stop()
  await wm?.stop()
})

beforeEach(async () => {
  await redis.flushall()
  await wm.restart()
})

afterEach(() => {
  while (reconcilers.length) reconcilers.pop()!.stop()
})

test('markerStub has the fixed shape', () => {
  const m = markerStub()
  expect(m.id).toBe(MARKER_ID)
  expect(m.persistent).toBe(false)
  expect(m.request).toEqual({ method: 'GET', urlPath: '/__wiremock-ui/marker' })
  expect(m.response).toMatchObject({ status: 204 })
  expect(m.metadata?.wiremockUi).toMatchObject({ source: 'marker', owner: 'system', version: 1 })
})

test('check() is ok when marker present', async () => {
  const rec = mk()
  expect(await rec.fullSync()).toBe('synced')
  expect(await rec.check()).toBe('ok')
  expect(rec.lastSyncAt).toBeInstanceOf(Date)
})

test('restores 1200 stubs after a WireMock restart', async () => {
  const ids = await fill(1200)
  const rec = mk()
  expect(await rec.fullSync()).toBe('synced')
  await wm.restart()
  expect(await rec.check()).toBe('synced')
  const live = await client.listStubIds()
  expect(live).toHaveLength(1201)
  expect(live).toContain(MARKER_ID)
  const res = await fetch(`${wm.url}/s/${ids[700]}`)
  expect(res.status).toBe(200)
  expect(await res.text()).toBe(ids[700])
}, 120_000)

test('removes stubs WireMock has but the store does not', async () => {
  await store.save(stubOf(uuid(1)), 0)
  const stray = stubOf(uuid(999))
  await client.importStubs([stray], { deleteAllNotInImport: false })
  const rec = mk()
  await rec.fullSync()
  expect(await client.getStub(stray.id)).toBeNull()
  expect(await client.getStub(uuid(1))).not.toBeNull()
  expect(await client.getStub(MARKER_ID)).not.toBeNull()
})

test('marker only after success; lock released after a failed sync', async () => {
  await fill(3)
  let fault = true
  let calls = 0
  const faulty = Object.create(client) as WireMockClient
  faulty.importStubs = async (stubs, o) => {
    calls++
    if (fault && calls === 2) throw new Error('boom')
    return client.importStubs(stubs, o)
  }
  const rec = new Reconciler({ wiremock: faulty, store, intervalMs: 60_000, batchSize: 1 })
  reconcilers.push(rec)
  await expect(rec.fullSync()).rejects.toThrow('boom')
  expect(await client.getStub(MARKER_ID)).toBeNull()
  expect(rec.lastError).toContain('boom')
  const token = await store.acquireLock('sync:lock', 1000)
  expect(token).not.toBeNull()
  await store.releaseLock('sync:lock', token!)
  fault = false
  expect(await rec.check()).toBe('synced')
  expect(await client.getStub(MARKER_ID)).not.toBeNull()
})

test('sync lock: concurrent fullSync calls from two reconcilers, one synced one skipped', async () => {
  await fill(300)
  const a = mk()
  const b = mk()
  const results = await Promise.all([a.fullSync(), b.fullSync()])
  expect([...results].sort()).toEqual(['skipped', 'synced'])
})

test('a stub saved after the snapshot survives fullSync (not deleted as extra)', async () => {
  await store.save(stubOf(uuid(1)), 0)
  const late = stubOf(uuid(2))
  let first = true
  const stale: MockStore = Object.create(store)
  stale.listAll = async () => {
    const snap = await store.listAll()
    if (first) {
      first = false
      await store.save(late, 0)
      await client.importStubs([late], { deleteAllNotInImport: false })
    }
    return snap
  }
  const rec = mk({ store: stale })
  await rec.fullSync()
  expect(await client.getStub(late.id)).not.toBeNull()
  expect(await client.getStub(uuid(1))).not.toBeNull()
})

test('start() syncs immediately and restores after restart within 3 intervals', async () => {
  await fill(5)
  const rec = mk({ intervalMs: 500 })
  await rec.start()
  expect(await client.getStub(MARKER_ID)).not.toBeNull()
  await wm.restart()
  expect(await until(async () => (await client.getStub(uuid(3))) !== null, 3000)).toBe(true)
  rec.stop()
})
