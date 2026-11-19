import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { ConflictError } from '../../../src/server/errors'
import { RedisMockStore } from '../../../src/server/store/redis'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startRedis } from '../../helpers/containers'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let handle: Awaited<ReturnType<typeof startRedis>>
let store: RedisMockStore
let redis: Redis

function mk(
  id: string,
  o: { version?: number; owner?: string; integration?: string; updatedAt?: string } = {},
): StubMapping {
  return {
    id,
    request: { method: 'GET', urlPath: `/t/${id}` },
    response: { status: 200 },
    metadata: {
      wiremockUi: {
        integration: o.integration,
        owner: o.owner ?? 'sara',
        version: o.version ?? 1,
        updatedAt: o.updatedAt ?? '2026-01-01T00:00:00.000Z',
        updatedBy: o.owner ?? 'sara',
        source: 'ui',
      },
    },
  } as StubMapping
}

const version = (s: StubMapping | null) => s?.metadata?.wiremockUi?.version

beforeAll(async () => {
  handle = await startRedis()
  store = new RedisMockStore(handle.url)
  redis = new Redis(handle.url)
})

afterAll(async () => {
  await store?.close()
  await redis?.quit()
  await handle?.stop()
})

beforeEach(async () => {
  await redis.flushdb()
})

test('save new then get', async () => {
  const s = mk(A, { version: 1 })
  await store.save(s, 0)
  expect(await store.get(A)).toEqual(s)
  expect(await store.get(B)).toBeNull()
  expect(await store.ping()).toBe(true)
})

test('create over existing id is a conflict', async () => {
  await store.save(mk(A, { version: 1 }), 0)
  await expect(store.save(mk(A, { version: 1 }), 0)).rejects.toBeInstanceOf(ConflictError)
})

test('stale expectedVersion is a conflict', async () => {
  await store.save(mk(A, { version: 1 }), 0)
  await store.save(mk(A, { version: 2 }), 1)
  await expect(store.save(mk(A, { version: 3 }), 1)).rejects.toBeInstanceOf(ConflictError)
  expect(version(await store.get(A))).toBe(2)
})

test('concurrent saves from same version: exactly one wins', async () => {
  await store.save(mk(A, { version: 1 }), 0)
  const r = await Promise.allSettled([
    store.save(mk(A, { version: 2, owner: 'x' }), 1),
    store.save(mk(A, { version: 2, owner: 'y' }), 1),
  ])
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(
    r.filter((x) => x.status === 'rejected' && x.reason instanceof ConflictError),
  ).toHaveLength(1)
})

test('list filters by integration and owner and sorts newest first', async () => {
  await store.save(mk(A, { integration: 'pay', owner: 'sara', updatedAt: '2026-01-01T00:00:00.000Z' }), 0)
  await store.save(mk(B, { integration: 'pay', owner: 'omar', updatedAt: '2026-02-01T00:00:00.000Z' }), 0)
  const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  await store.save(mk(C, { integration: 'crm', owner: 'sara', updatedAt: '2026-03-01T00:00:00.000Z' }), 0)

  expect((await store.list()).map((s) => s.id)).toEqual([C, B, A])
  expect((await store.list({ integration: 'pay' })).map((s) => s.id)).toEqual([B, A])
  expect((await store.list({ owner: 'sara' })).map((s) => s.id)).toEqual([C, A])
  expect((await store.list({ integration: 'pay', owner: 'sara' })).map((s) => s.id)).toEqual([A])
  expect(await store.list({ integration: 'nope' })).toEqual([])
  expect((await store.listAll()).map((s) => s.id).sort()).toEqual([A, B, C].sort())
})

test('changing owner moves the stub between owner indexes', async () => {
  await store.save(mk(A, { version: 1, owner: 'sara' }), 0)
  expect(await store.list({ owner: 'sara' })).toHaveLength(1)
  await store.save(mk(A, { version: 2, owner: 'omar' }), 1)
  expect(await store.list({ owner: 'sara' })).toEqual([])
  expect(await store.list({ owner: 'omar' })).toHaveLength(1)
})

test('history keeps last 20, newest first', async () => {
  await store.save(mk(A, { version: 1 }), 0)
  for (let v = 2; v <= 25; v++) await store.save(mk(A, { version: v }), v - 1)
  const h = await store.history(A)
  expect(h).toHaveLength(20)
  expect(version(h[0] ?? null)).toBe(24)
})

test('delete removes from indexes and sets 7-day TTL on history', async () => {
  await store.save(mk(A, { version: 1, integration: 'pay', owner: 'sara' }), 0)
  await store.save(mk(A, { version: 2, integration: 'pay', owner: 'sara' }), 1)
  await expect(store.delete(A, 1)).rejects.toBeInstanceOf(ConflictError)
  await store.delete(A, 2)
  expect(await store.get(A)).toBeNull()
  expect(await store.list()).toEqual([])
  expect(await store.list({ integration: 'pay' })).toEqual([])
  expect(await store.list({ owner: 'sara' })).toEqual([])
  expect(await redis.ttl('stub:' + A + ':history')).toBeGreaterThan(604700)
  expect(await redis.ttl('stub:' + A + ':history')).toBeLessThanOrEqual(604800)
  const h = await store.history(A)
  expect(h.map(version)).toEqual([2, 1])
  await store.delete(B) // missing id resolves
})

test('re-saving after delete persists history again', async () => {
  await store.save(mk(A, { version: 1 }), 0)
  await store.delete(A)
  await store.save(mk(A, { version: 2 }), 0)
  await store.save(mk(A, { version: 3 }), 2)
  expect(await redis.ttl('stub:' + A + ':history')).toBe(-1)
})

test('lock: second acquire gets null, wrong token cannot release', async () => {
  const t = await store.acquireLock('sync:lock', 10_000)
  expect(t).toEqual(expect.any(String))
  expect(await store.acquireLock('sync:lock', 10_000)).toBeNull()
  await store.releaseLock('sync:lock', 'wrong')
  expect(await store.acquireLock('sync:lock', 10_000)).toBeNull()
  await store.releaseLock('sync:lock', t as string)
  expect(await store.acquireLock('sync:lock', 10_000)).toEqual(expect.any(String))
})

test('close() leaves an injected connection open', async () => {
  const shared = new Redis(handle.url)
  const injected = new RedisMockStore(shared)
  await injected.close()
  expect(await shared.ping()).toBe('PONG')
  await shared.quit()
})
