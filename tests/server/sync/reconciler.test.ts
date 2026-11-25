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

afterEach(async () => {
  // Waits for a sync still running: finishing after the next test's WireMock restart, it would write the marker there.
  await Promise.all(reconcilers.splice(0).map((r) => r.stop()))
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

test('a WireMock reset right before the marker import fails the sync and leaves no marker', async () => {
  await fill(5)
  let resetOnce = true
  const resetting = Object.create(client) as WireMockClient
  resetting.importStubs = async (stubs, o) => {
    if (resetOnce && stubs.some((s) => s.id === MARKER_ID)) {
      resetOnce = false
      await wm.restart()
    }
    return client.importStubs(stubs, o)
  }
  const rec = mk({ wiremock: resetting })
  await expect(rec.fullSync()).rejects.toThrow(/changed during sync/)
  expect(await client.getStub(MARKER_ID)).toBeNull()
  expect(rec.lastError).toMatch(/changed during sync/)
  expect(rec.lastSyncAt).toBeNull()
  expect(await rec.check()).toBe('synced')
  expect((await client.listStubIds()).length).toBe(6)
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
  await rec.stop()
})

test('start() survives a failing first sync and recovers on a later tick', async () => {
  await fill(3)
  let fault = true
  const faulty = Object.create(client) as WireMockClient
  faulty.importStubs = async (stubs, o) => {
    if (fault) throw new Error('boom')
    return client.importStubs(stubs, o)
  }
  const rec = mk({ wiremock: faulty, intervalMs: 300 })
  await rec.start()
  expect(rec.lastError).toContain('boom')
  expect(await client.getStub(MARKER_ID)).toBeNull()
  fault = false
  expect(await until(async () => rec.lastError === null && rec.lastSyncAt !== null, 3000)).toBe(true)
  expect(await client.getStub(MARKER_ID)).not.toBeNull()
})

test('stop() waits for a sync already running, so it cannot write to WireMock afterwards', async () => {
  await fill(3)
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const slow = Object.create(client) as WireMockClient
  slow.importStubs = async (stubs, o) => {
    await gate
    return client.importStubs(stubs, o)
  }
  const rec = mk({ wiremock: slow })
  const starting = rec.start()
  let stopped = false
  const stopping = rec.stop().then(() => (stopped = true))
  await new Promise((r) => setTimeout(r, 200))
  expect(stopped).toBe(false)
  release()
  await stopping
  await starting
  // Everything the sync writes is in WireMock by the time stop() resolves.
  expect(await client.getStub(MARKER_ID)).not.toBeNull()
})

test('guard (a): a stub in the store but absent from every snapshot is never deleted', async () => {
  await store.save(stubOf(uuid(1)), 0)
  const late = stubOf(uuid(2))
  await store.save(late, 0)
  await client.importStubs([late], { deleteAllNotInImport: false })
  const hiding: MockStore = Object.create(store)
  hiding.listAll = async () => (await store.listAll()).filter((s) => s.id !== late.id)
  const deleted: string[] = []
  const spy = Object.create(client) as WireMockClient
  spy.deleteStub = async (id) => {
    deleted.push(id)
    return client.deleteStub(id)
  }
  await mk({ wiremock: spy, store: hiding }).fullSync()
  expect(deleted).not.toContain(late.id)
  expect(await client.getStub(late.id)).not.toBeNull()
})

test('guard (b): a stub updated during the sync ends up at the new version in WireMock', async () => {
  const v1 = stubOf(uuid(1))
  await store.save(v1, 0)
  const v2: StubMapping = {
    ...v1,
    response: { status: 200, body: 'second' },
    metadata: { wiremockUi: { ...v1.metadata!.wiremockUi!, version: 2 } },
  }
  let first = true
  const racing: MockStore = Object.create(store)
  racing.listAll = async () => {
    const snap = await store.listAll()
    if (first) {
      first = false
      await store.save(v2, 1)
      await client.importStubs([v2], { deleteAllNotInImport: false })
    }
    return snap
  }
  await mk({ store: racing }).fullSync()
  const res = await fetch(`${wm.url}/s/${v1.id}`)
  expect(await res.text()).toBe('second')
})

test('a mock deleted during the sync is not resurrected', async () => {
  const a = stubOf(uuid(1))
  const b = stubOf(uuid(2))
  await store.save(a, 0)
  await store.save(b, 0)
  let first = true
  const racing: MockStore = Object.create(store)
  racing.listAll = async () => {
    const snap = await store.listAll()
    if (first) {
      first = false
      await store.delete(a.id)
      await client.deleteStub(a.id)
    }
    return snap
  }
  await mk({ store: racing }).fullSync()
  expect(await client.getStub(a.id)).toBeNull()
  expect(await client.getStub(b.id)).not.toBeNull()
})

test('audit entry after a marker-triggered full sync, none for a plain fullSync', async () => {
  await fill(3)
  const entries: { actor: string; action: string; details?: Record<string, unknown> }[] = []
  const audit = { record: async (e: (typeof entries)[number]) => void entries.push(e), list: async () => ({ entries: [], nextCursor: null }) }
  const rec = new Reconciler({ wiremock: client, store, intervalMs: 60_000, audit })
  reconcilers.push(rec)
  await rec.fullSync()
  expect(entries).toEqual([])
  await client.deleteStub(MARKER_ID)
  expect(await rec.check()).toBe('synced')
  expect(entries).toEqual([{ actor: 'system', action: 'sync', details: { stubs: 3 } }])
})

test('an audit failure does not fail the sync', async () => {
  const audit = { record: async () => Promise.reject(new Error('redis down')), list: async () => ({ entries: [], nextCursor: null }) }
  const rec = new Reconciler({ wiremock: client, store, intervalMs: 60_000, audit })
  reconcilers.push(rec)
  await client.deleteStub(MARKER_ID)
  expect(await rec.check()).toBe('synced')
})

const tied = (id: string, owner: string, updatedAt: string, path: string): StubMapping => ({
  ...stubOf(id, path),
  priority: 5,
  response: { status: 200, body: id },
  metadata: { wiremockUi: { owner, version: 1, updatedAt, updatedBy: owner, source: 'ui' } },
})
const answer = async (path: string) => (await fetch(`${wm.url}${path}`)).text()

test('equal-priority precedence after a restart: person beats baseline, newest person wins, for any batch size', async () => {
  const stubs = [
    tied(uuid(11), 'sara', '2026-01-01T00:00:00.000Z', '/tie/one'),
    tied(uuid(12), 'baseline', '2026-03-01T00:00:00.000Z', '/tie/one'),
    tied(uuid(21), 'baseline', '2026-05-01T00:00:00.000Z', '/tie/two'),
    tied(uuid(22), 'sara', '2026-02-02T00:00:00.000Z', '/tie/two'),
    tied(uuid(23), 'omar', '2026-02-01T00:00:00.000Z', '/tie/two'),
  ]
  for (const s of stubs) await store.save(s, 0)
  for (const batchSize of [1, 2, 500]) {
    await wm.restart()
    const rec = new Reconciler({ wiremock: client, store, intervalMs: 60_000, batchSize })
    reconcilers.push(rec)
    expect(await rec.check()).toBe('synced')
    expect(await answer('/tie/one'), `batch ${batchSize}`).toBe(uuid(11))
    expect(await answer('/tie/two'), `batch ${batchSize}`).toBe(uuid(22))
  }
})

test('a person mock saved after a WireMock reset still beats the baseline the next check() re-adds', async () => {
  const base = tied(uuid(31), 'baseline', '2026-01-01T00:00:00.000Z', '/tie/three')
  const mine = tied(uuid(32), 'sara', '2026-01-02T00:00:00.000Z', '/tie/three')
  await store.save(base, 0)
  const rec = mk()
  await rec.fullSync()
  await wm.restart()
  // Saved through the UI between the reset and the next marker check.
  await client.importStubs([mine], { deleteAllNotInImport: false })
  await store.save(mine, 0)
  expect(await rec.check()).toBe('synced')
  expect(await answer('/tie/three')).toBe(uuid(32))
})

test('repositionPersonMocks puts person mocks above a baseline mock added after them', async () => {
  const mine = tied(uuid(41), 'sara', '2026-01-01T00:00:00.000Z', '/tie/four')
  await store.save(mine, 0)
  const rec = mk()
  await rec.fullSync()
  const base = tied(uuid(42), 'baseline', '2026-01-02T00:00:00.000Z', '/tie/four')
  await store.save(base, 0)
  await client.importStubs([base], { deleteAllNotInImport: false })
  expect(await answer('/tie/four')).toBe(uuid(42))
  await rec.repositionPersonMocks()
  expect(await answer('/tie/four')).toBe(uuid(41))
  expect(await rec.check()).toBe('ok')
})
