import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { loadConfig } from '../../../src/server/config'
import { logger } from '../../../src/server/logger'
import { bootRuntime, type Runtime } from '../../../src/server/runtime'
import { createStores } from '../../../src/server/store'
import { MARKER_ID } from '../../../src/server/sync/marker'
import { adoptMissing, markAdoptionIfDue } from '../../../src/server/sync/adopt'
import { ADOPTION_PENDING, Reconciler, SYNC_LOCK } from '../../../src/server/sync/reconciler'
import type { Stores } from '../../../src/server/store'
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
    await rt.reconciler?.stop()
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
    await client.importStubs(
      [
        // A stub an older UI linked to an integration: the start-up migration turns the link into a tag.
        existing(1, '/pay/charges', { metadata: { wiremockUi: { integration: 'pay' } as never } }),
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
      expect(stub.metadata?.wiremockUi).toMatchObject({ owner: stub.id === uid(2) ? 'sara' : 'wiremock', source: 'adopt', version: stub.id === uid(1) ? 2 : 1, updatedBy: 'system' })
    }
    expect((await rt.store.get(uid(1)))?.metadata?.wiremockUi).toMatchObject({ tags: ['pay'] })
    expect((await rt.store.get(uid(1)))?.metadata?.wiremockUi?.integration).toBeUndefined()
    expect((await rt.store.get(uid(2)))?.metadata?.wiremockUi?.tags).toBeUndefined()
    expect((await rt.store.get(uid(3)))?.metadata).toMatchObject({ team: 'qa' })

    // The first full sync ran and kept them: still served, plus the marker.
    expect(rt.reconciler?.lastSyncAt).not.toBeNull()
    expect(await (await fetch(`${wm.url}/pay/charges`)).text()).toBe('existing-1')
    expect(await (await fetch(`${wm.url}/orders/1`)).text()).toBe('existing-2')
    expect(await (await fetch(`${wm.url}/hello`)).text()).toBe('existing-3')
    // Adoption wrote only to the store: the stub WireMock keeps in its files stays persistent.
    expect((await client.getStub(uid(2)))?.persistent).toBe(true)
    expect(await rt.store.getFlag(ADOPTION_PENDING)).toBe(false)
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
    await first.reconciler?.stop()
    await first.stores.close()
    rmSync(join(dir, 'ui.db'))
    const second = await bootRuntime(env)
    expect(await second.store.listAll()).toEqual([])
    expect((await second.audit.list()).entries.filter((e) => e.action === 'adopt')).toEqual([])
    await second.reconciler?.stop()
    await second.stores.close()
    rmSync(join(dir, 'ui.db'))

    await client.importStubs([existing(5, '/file', { response: { status: 200, bodyFileName: 'missing.json' } })], { deleteAllNotInImport: false })
    const third = await bootRuntime(env)
    expect((await third.store.get(uid(5)))?.response).toEqual({ status: 200, bodyFileName: 'missing.json' })
    expect(await client.getStub(uid(5))).not.toBeNull()
    await third.reconciler?.stop()
    await third.stores.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    await wm.stop().catch(() => {})
  }
})

/** A WireMock container plus a SQLite store on a temp file, for the adoption internals. */
async function sqliteRig() {
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
  return {
    wm,
    client,
    env,
    open: () => createStores(loadConfig(env)),
    async stop() {
      rmSync(dir, { recursive: true, force: true })
      await wm.stop().catch(() => {})
    },
  }
}

test('adoption takes the sync lock: of two concurrent adoptions one adopts, the other skips; a held lock skips it', async () => {
  const rig = await sqliteRig()
  const stores = rig.open()
  try {
    await rig.client.importStubs([existing(21, '/a'), existing(22, '/b')], { deleteAllNotInImport: false })
    const store = stores.mocks
    const deps = { wiremock: rig.client, store, audit: stores.audit }
    const info = vi.spyOn(logger, 'info')
    expect(await markAdoptionIfDue(rig.client, store)).toBe(true)
    expect(await store.getFlag(ADOPTION_PENDING)).toBe(true)

    // Held by someone else (another instance adopting or syncing): skip, say so, and leave the flag set.
    const token = await store.acquireLock(SYNC_LOCK, 60_000)
    expect(await adoptMissing(deps)).toBe(0)
    expect(info.mock.calls.some(([msg]) => String(msg).includes('adoption deferred: the sync lock is held'))).toBe(true)
    expect(await store.getFlag(ADOPTION_PENDING)).toBe(true)
    await store.releaseLock(SYNC_LOCK, token!)

    const counts = await Promise.all([adoptMissing(deps), adoptMissing(deps)])
    expect(counts.sort()).toEqual([0, 2])
    expect((await store.listAll()).map((s) => s.id).sort()).toEqual([uid(21), uid(22)])
    expect((await stores.audit.list()).entries.filter((e) => e.action === 'adopt')).toHaveLength(1)
    expect(await store.getFlag(ADOPTION_PENDING)).toBe(false)
    // Released afterwards; and with mocks stored, adoption is no longer due.
    expect(await store.acquireLock(SYNC_LOCK, 1000)).not.toBeNull()
    expect(await markAdoptionIfDue(rig.client, store)).toBe(false)
    info.mockRestore()
  } finally {
    await stores.close()
    await rig.stop()
  }
})

test('a boot that stops part-way through adoption leaves it pending: the next boot adopts the rest and nothing is deleted', async () => {
  const rig = await sqliteRig()
  try {
    await rig.client.importStubs([existing(31, '/p1'), existing(32, '/p2'), existing(33, '/p3')], { deleteAllNotInImport: false })
    // The second adopted stub fails to save (store hiccup, killed process…).
    let adoptSaves = 0
    const flaky = (config: Parameters<typeof createStores>[0], opts: Parameters<typeof createStores>[1]): Stores => {
      const s = createStores(config, opts)
      const save = s.mocks.save.bind(s.mocks)
      s.mocks.save = async (stub, v) => {
        if (stub.metadata?.wiremockUi?.source === 'adopt' && ++adoptSaves === 2) throw new Error('store went away')
        return save(stub, v)
      }
      return s
    }
    await expect(bootRuntime(rig.env, { createStores: flaky })).rejects.toThrow('store went away')
    const half = rig.open()
    expect((await half.mocks.listAll()).map((s) => s.id)).toEqual([uid(31)])
    expect(await half.mocks.getFlag(ADOPTION_PENDING)).toBe(true)
    await half.close()

    const rt = await bootRuntime(rig.env)
    try {
      expect((await rt.store.listAll()).map((s) => s.id).sort()).toEqual([uid(31), uid(32), uid(33)])
      expect(await rt.store.getFlag(ADOPTION_PENDING)).toBe(false)
      for (const n of [1, 2, 3]) expect(await (await fetch(`${rig.wm.url}/p${n}`)).text()).toBe(`existing-3${n}`)
      expect((await rig.client.listStubIds()).sort()).toEqual([uid(31), uid(32), uid(33), MARKER_ID].sort())
    } finally {
      await rt.reconciler?.stop()
      await rt.stores.close()
    }
  } finally {
    await rig.stop()
  }
})

test('a full sync while adoption is pending deletes no live stub', async () => {
  const rig = await sqliteRig()
  const stores = rig.open()
  try {
    await rig.client.importStubs([existing(41, '/q1'), existing(42, '/q2')], { deleteAllNotInImport: false })
    await stores.mocks.setFlag(ADOPTION_PENDING, true)
    const reconciler = new Reconciler({ wiremock: rig.client, store: stores.mocks, intervalMs: 60_000 })
    expect(await reconciler.fullSync()).toBe('synced')
    expect((await rig.client.listStubIds()).sort()).toEqual([uid(41), uid(42), MARKER_ID].sort())
    // Once adoption is done (flag cleared) the store is the source of truth again.
    await stores.mocks.setFlag(ADOPTION_PENDING, false)
    expect(await reconciler.fullSync()).toBe('synced')
    expect(await rig.client.listStubIds()).toEqual([MARKER_ID])
  } finally {
    await stores.close()
    await rig.stop()
  }
})

test('a full sync retries a pending adoption (one that failed or was left by a dead instance) before syncing', async () => {
  const rig = await sqliteRig()
  const stores = rig.open()
  try {
    await rig.client.importStubs([existing(51, '/r1'), existing(52, '/r2')], { deleteAllNotInImport: false })
    await stores.mocks.setFlag(ADOPTION_PENDING, true)
    let tries = 0
    const adopt = async () => {
      if (++tries === 1) throw new Error('store hiccup')
      return adoptMissing({ wiremock: rig.client, store: stores.mocks, audit: stores.audit })
    }
    const reconciler = new Reconciler({ wiremock: rig.client, store: stores.mocks, intervalMs: 60_000, adopt })
    // The first try fails: the sync still runs and deletes nothing.
    expect(await reconciler.fullSync()).toBe('synced')
    expect((await rig.client.listStubIds()).sort()).toEqual([uid(51), uid(52), MARKER_ID].sort())
    expect(await stores.mocks.getFlag(ADOPTION_PENDING)).toBe(true)
    // The next sync adopts them; they stay.
    expect(await reconciler.fullSync()).toBe('synced')
    expect(await stores.mocks.getFlag(ADOPTION_PENDING)).toBe(false)
    expect((await stores.mocks.listAll()).map((m) => m.id).sort()).toEqual([uid(51), uid(52)])
    expect((await rig.client.listStubIds()).sort()).toEqual([uid(51), uid(52), MARKER_ID].sort())
  } finally {
    await stores.close()
    await rig.stop()
  }
})
