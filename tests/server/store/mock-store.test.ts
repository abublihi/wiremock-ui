import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { ConflictError } from '../../../src/server/errors'
import { RedisMockStore } from '../../../src/server/store/redis'
import type { MockStore } from '../../../src/server/store/types'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { drivers, type StoreHarness } from '../../helpers/stores'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

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

describe.each(drivers)('MockStore on %s', (driver, start) => {
  let h: StoreHarness
  let store: MockStore

  beforeAll(async () => {
    h = await start()
    store = h.stores.mocks
  })

  afterAll(async () => {
    await h?.stop()
  })

  beforeEach(async () => {
    await h.probe.reset()
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
    expect(await h.probe.historyTtl(A)).toBeGreaterThan(604700)
    expect(await h.probe.historyTtl(A)).toBeLessThanOrEqual(604800)
    const hist = await store.history(A)
    expect(hist.map(version)).toEqual([2, 1])
    await store.delete(B) // missing id resolves
  })

  test('re-saving after delete persists history again', async () => {
    await store.save(mk(A, { version: 1 }), 0)
    await store.delete(A)
    await store.save(mk(A, { version: 2 }), 0)
    await store.save(mk(A, { version: 3 }), 2)
    expect(await h.probe.historyTtl(A)).toBe(-1)
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

  test('lock expires after its TTL', async () => {
    expect(await store.acquireLock('ttl:lock', 50)).toEqual(expect.any(String))
    expect(await store.acquireLock('ttl:lock', 50)).toBeNull()
    await new Promise((r) => setTimeout(r, 120))
    expect(await store.acquireLock('ttl:lock', 50)).toEqual(expect.any(String))
  })

  if (driver === 'redis') {
    test('close() leaves an injected connection open', async () => {
      const shared = new Redis(h.redisUrl as string)
      const injected = new RedisMockStore(shared)
      await injected.close()
      expect(await shared.ping()).toBe('PONG')
      await shared.quit()
    })
  }

  if (driver === 'sqlite') {
    test('SQLite data survives close + reopen', async () => {
      await store.save(mk(A, { version: 1, integration: 'pay' }), 0)
      await store.save(mk(A, { version: 2, integration: 'pay' }), 1)
      await h.stores.users.createUser({
        id: 'u1', username: 'alice', displayName: 'Alice', role: 'tester', passwordHash: 'h',
        disabled: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      })
      const session = await h.stores.users.createSession('u1', 600)
      await h.stores.audit.record({ actor: 'alice', action: 'test.persist' })
      await h.stores.catalog.putIntegration({ key: 'pay', name: 'Pay', prefix: '/pay', updatedAt: 'x', updatedBy: 'alice' })

      const reopened = h.reopen!()
      store = reopened.mocks
      expect(await reopened.ping()).toBe(true)
      expect(version(await reopened.mocks.get(A))).toBe(2)
      expect((await reopened.mocks.list({ integration: 'pay' })).map((s) => s.id)).toEqual([A])
      expect((await reopened.mocks.history(A)).map(version)).toEqual([1])
      expect((await reopened.users.getUserByName('ALICE'))?.id).toBe('u1')
      expect(await reopened.users.getSession(session.id)).toEqual(session)
      expect((await reopened.audit.list()).entries.map((e) => e.action)).toEqual(['test.persist'])
      expect((await reopened.catalog.listIntegrations()).map((i) => i.key)).toEqual(['pay'])
    })

    test('ping is false after close', async () => {
      const reopened = h.reopen!()
      await reopened.close()
      expect(await reopened.ping()).toBe(false)
      store = h.reopen!().mocks
    })
  }
})
