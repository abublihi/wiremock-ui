import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { loadConfig } from '../../../src/server/config'
import { logger } from '../../../src/server/logger'
import { bootRuntime, type Runtime } from '../../../src/server/runtime'
import { createStores } from '../../../src/server/store'
import { MARKER_ID } from '../../../src/server/sync/marker'
import { CatalogService } from '../../../src/server/catalog/service'
import { MockService } from '../../../src/server/mocks/service'
import { adoptStubs, stubsToAdopt } from '../../../src/server/sync/adopt'
import { SYNC_LOCK } from '../../../src/server/sync/reconciler'
import { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startRedis, startWireMock, type WireMockHandle } from '../../helpers/containers'

const uid = (n: number) => `0000a0a0-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Stubs a team made in WireMock directly: no wiremockUi metadata, some persistent. */
const existing = (n: number, path: string, extra: Partial<StubMapping> = {}): StubMapping => ({
  id: uid(n),
  name: `existing ${n}`,
  request: { method: 'GET', urlPath: path },
  response: { status: 200, body: `existing-${n}` },
  ...extra,
})

type DriverSetup = { env: Record<string, string>; stop(): Promise<void> }

const drivers: [string, () => Promise<DriverSetup>][] = [
  [
    'redis',
    async () => {
      const redis = await startRedis()
      return { env: { REDIS_URL: redis.url }, stop: () => redis.stop() }
    },
  ],
  [
    'sqlite',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'wmui-adopt-'))
      return {
        env: { STORE_DRIVER: 'sqlite', SQLITE_PATH: join(dir, 'ui.db') },
        stop: async () => rmSync(dir, { recursive: true, force: true }),
      }
    },
  ],
]

describe.each(drivers)('adopting existing WireMock stubs (%s)', (_name, setup) => {
  let wm: WireMockHandle
  let store: DriverSetup
  let client: WireMockClient
  let env: Record<string, string>
  const runtimes: Runtime[] = []

  const boot = async () => {
    const rt = await bootRuntime(env)
    runtimes.push(rt)
    return rt
  }
  const shutdown = async (rt: Runtime) => {
    rt.reconciler?.stop()
    await rt.stores.close()
  }

  beforeAll(async () => {
    wm = await startWireMock()
    store = await setup()
    client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
    env = {
      WIREMOCK_URL: wm.url,
      WIREMOCK_ADMIN_USER: wm.user,
      WIREMOCK_ADMIN_PASSWORD: wm.password,
      ...store.env,
      ADMIN_USER: 'ui-admin',
      ADMIN_PASSWORD: 'ui-admin-pass',
      SESSION_SECRET: 'x',
      SYNC_INTERVAL_SECONDS: '3600',
    }
  }, 120_000)

  afterAll(async () => {
    for (const rt of runtimes) await shutdown(rt).catch(() => {})
    await store?.stop()
    await wm?.stop().catch(() => {})
  })

  test('an empty store adopts the stubs WireMock already has instead of deleting them', async () => {
    // A catalog entry from before (the store has no mocks yet) lets adoption guess the integration.
    const pre = createStores(loadConfig(env))
    await pre.catalog.putIntegration({ key: 'pay', name: 'Payments', prefix: '/pay', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'x' })
    await pre.close()

    await client.importStubs(
      [
        existing(1, '/pay/charges'),
        // A stub a store-backed UI made earlier keeps the owner it names.
        existing(2, '/orders/1', { persistent: true, metadata: { wiremockUi: { owner: 'sara' } as never } }),
        existing(3, '/hello', { metadata: { team: 'qa' } }),
      ],
      { deleteAllNotInImport: false },
    )
    const info = vi.spyOn(logger, 'info')
    const rt = await boot()

    const adopted = await rt.store.listAll()
    expect(adopted.map((s) => s.id).sort()).toEqual([uid(1), uid(2), uid(3)])
    for (const stub of adopted) {
      expect(stub.metadata?.wiremockUi).toMatchObject({ owner: stub.id === uid(2) ? 'sara' : 'wiremock', source: 'adopt', version: 1, updatedBy: 'system' })
    }
    expect((await rt.store.get(uid(1)))?.metadata?.wiremockUi?.integration).toBe('pay')
    expect((await rt.store.get(uid(2)))?.metadata?.wiremockUi?.integration).toBeUndefined()
    expect((await rt.store.get(uid(3)))?.metadata).toMatchObject({ team: 'qa' })

    // The first full sync ran and kept them: still served, plus the marker.
    expect(rt.reconciler?.lastSyncAt).not.toBeNull()
    expect(await (await fetch(`${wm.url}/pay/charges`)).text()).toBe('existing-1')
    expect(await (await fetch(`${wm.url}/orders/1`)).text()).toBe('existing-2')
    expect(await (await fetch(`${wm.url}/hello`)).text()).toBe('existing-3')
    expect((await client.listStubIds()).sort()).toEqual([uid(1), uid(2), uid(3), MARKER_ID].sort())

    expect(info.mock.calls.some(([obj, msg]) => msg === 'adopted 3 existing WireMock stubs' && (obj as { count?: number }).count === 3)).toBe(true)
    const audit = (await rt.audit.list()).entries.filter((e) => e.action === 'adopt')
    expect(audit).toEqual([expect.objectContaining({ actor: 'system', details: { count: 3 } })])
    info.mockRestore()
    await shutdown(rt)
  })

  test('once the store has mocks it stays the source of truth: a later boot does not adopt', async () => {
    await client.importStubs([existing(9, '/stray')], { deleteAllNotInImport: false })
    const rt = await boot()
    expect(await rt.store.get(uid(9))).toBeNull()
    expect(await client.getStub(uid(9))).toBeNull()
    expect((await rt.audit.list()).entries.filter((e) => e.action === 'adopt')).toHaveLength(1)
    await shutdown(rt)
  })
})

test('the marker alone is nothing to adopt, and a bodyFileName stub is adopted rather than deleted', async () => {
  const wm = await startWireMock()
  const dir = mkdtempSync(join(tmpdir(), 'wmui-adopt-'))
  const client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
  const env = {
    WIREMOCK_URL: wm.url,
    WIREMOCK_ADMIN_USER: wm.user,
    WIREMOCK_ADMIN_PASSWORD: wm.password,
    STORE_DRIVER: 'sqlite',
    SQLITE_PATH: join(dir, 'ui.db'),
    ADMIN_USER: 'ui-admin',
    ADMIN_PASSWORD: 'ui-admin-pass',
    SESSION_SECRET: 'x',
    SYNC_INTERVAL_SECONDS: '3600',
  }
  try {
    // First boot on an empty WireMock leaves only the marker behind; a second boot on a fresh store adopts nothing.
    const first = await bootRuntime(env)
    first.reconciler?.stop()
    await first.stores.close()
    rmSync(join(dir, 'ui.db'))
    const second = await bootRuntime(env)
    expect(await second.store.listAll()).toEqual([])
    expect((await second.audit.list()).entries.filter((e) => e.action === 'adopt')).toEqual([])
    second.reconciler?.stop()
    await second.stores.close()
    rmSync(join(dir, 'ui.db'))

    await client.importStubs([existing(5, '/file', { response: { status: 200, bodyFileName: 'missing.json' } })], { deleteAllNotInImport: false })
    const third = await bootRuntime(env)
    expect((await third.store.get(uid(5)))?.response).toEqual({ status: 200, bodyFileName: 'missing.json' })
    expect(await client.getStub(uid(5))).not.toBeNull()
    third.reconciler?.stop()
    await third.stores.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    await wm.stop().catch(() => {})
  }
})

test('adoption takes the sync lock: of two concurrent adoptions one adopts, the other skips; a held lock skips it', async () => {
  const wm = await startWireMock()
  const dir = mkdtempSync(join(tmpdir(), 'wmui-adopt-'))
  const client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
  const stores = createStores(loadConfig({ ADMIN_USER: 'a', ADMIN_PASSWORD: 'b', SESSION_SECRET: 'c', STORE_DRIVER: 'sqlite', SQLITE_PATH: join(dir, 'ui.db') }))
  try {
    await client.importStubs([existing(21, '/a'), existing(22, '/b')], { deleteAllNotInImport: false })
    const store = stores.mocks
    const mocks = new MockService({ wiremock: client, store, audit: stores.audit })
    const catalog = new CatalogService({ catalog: stores.catalog, audit: stores.audit, mocks: store })
    const deps = { mocks, store, catalog, audit: stores.audit }
    const info = vi.spyOn(logger, 'info')

    // Held by someone else (another instance adopting or syncing): skip, and say so.
    const token = await store.acquireLock(SYNC_LOCK, 60_000)
    expect(await adoptStubs(await stubsToAdopt(client, store), deps)).toBe(0)
    expect(info.mock.calls.some(([, msg]) => String(msg).includes('another instance holds the sync lock'))).toBe(true)
    await store.releaseLock(SYNC_LOCK, token!)

    const list = await stubsToAdopt(client, store)
    const counts = await Promise.all([adoptStubs(list, deps), adoptStubs(list, deps)])
    expect(counts.sort()).toEqual([0, 2])
    expect((await store.listAll()).map((s) => s.id).sort()).toEqual([uid(21), uid(22)])
    expect((await stores.audit.list()).entries.filter((e) => e.action === 'adopt')).toHaveLength(1)
    // Released afterwards.
    const again = await store.acquireLock(SYNC_LOCK, 1000)
    expect(again).not.toBeNull()
    info.mockRestore()
  } finally {
    await stores.close()
    rmSync(dir, { recursive: true, force: true })
    await wm.stop().catch(() => {})
  }
})
