import { expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError } from '../../src/server/errors'
import { logger } from '../../src/server/logger'
import { bootRuntime } from '../../src/server/runtime'
import type { Stores } from '../../src/server/store'

const env = {
  WIREMOCK_URL: 'http://wm',
  WIREMOCK_ADMIN_USER: 'a',
  WIREMOCK_ADMIN_PASSWORD: 'b',
  REDIS_URL: 'redis://r:6379',
  ADMIN_USER: 'u',
  ADMIN_PASSWORD: 'p',
  SESSION_SECRET: 's',
  SYNC_INTERVAL_SECONDS: '3600',
}

const fakeStore = (pings: boolean[] = []): Stores =>
  ({
    ping: async () => pings.shift() ?? true,
    close: async () => {},
    mocks: {
      listAll: async () => [],
      get: async () => null,
      acquireLock: async () => 'tok',
      releaseLock: async () => {},
      getFlag: async () => false,
      setFlag: async () => {},
    },
    users: { countUsers: async () => 1 },
    audit: { record: async () => {} },
  }) as unknown as Stores

// Behaves like a locked-down WireMock 3.x once "up"; refuses connections for the first `failures` calls.
const wiremockFetch = (failures: number) => {
  let calls = 0
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++
    if (calls <= failures) throw new TypeError('fetch failed')
    const authed = new Headers(init?.headers).has('authorization')
    if (!authed) return new Response('unauthorized', { status: 401 })
    if (String(input).includes('/__admin/version')) return new Response(JSON.stringify({ version: '3.13.1' }), { status: 200 })
    return new Response(JSON.stringify({ mappings: [] }), { status: 200 })
  }) as typeof fetch
  return { fn, calls: () => calls }
}

test('boot retries until WireMock and the store become reachable', async () => {
  const wm = wiremockFetch(3)
  const sleeps: number[] = []
  const pings = [false, true]
  const rt = await bootRuntime(env, {
    fetch: wm.fn,
    createStores: () => fakeStore(pings),
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  rt.reconciler?.stop()
  expect(sleeps).toEqual([500, 1000, 2000, 500])
})

test('a ConfigError fails immediately without retrying', async () => {
  const open = (async () => new Response(JSON.stringify({ mappings: [] }), { status: 200 })) as typeof fetch
  let slept = 0
  await expect(
    bootRuntime(env, { fetch: open, createStores: () => fakeStore(), sleep: async () => void slept++ }),
  ).rejects.toBeInstanceOf(ConfigError)
  expect(slept).toBe(0)
})

test('gives up with the last reachability error after BOOT_TIMEOUT_SECONDS', async () => {
  const wm = wiremockFetch(Infinity)
  const t0 = Date.now()
  await expect(bootRuntime({ ...env, BOOT_TIMEOUT_SECONDS: '1' }, { fetch: wm.fn, createStores: () => fakeStore() })).rejects.toThrow(
    /WireMock unreachable/,
  )
  expect(Date.now() - t0).toBeLessThan(5000)
})

test('boot retries a hung store ping until reachable', async () => {
  const wm = wiremockFetch(0)
  let attempts = 0
  const hung = (): Stores => {
    const s = fakeStore()
    if (attempts++ === 0) (s as unknown as { ping: () => Promise<boolean> }).ping = () => new Promise(() => {})
    return s
  }
  const rt = await bootRuntime(env, { fetch: wm.fn, createStores: hung, sleep: async () => {} })
  rt.reconciler?.stop()
  expect(attempts).toBe(2)
}, 10_000)

test('boots on SQLite with no Redis at all: first admin created, store reachable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wmui-boot-'))
  const { REDIS_URL: _unused, ...noRedis } = env
  try {
    const rt = await bootRuntime({ ...noRedis, ADMIN_USER: 'root', ADMIN_PASSWORD: 'rootpass1', SQLITE_PATH: join(dir, 'sub', 'ui.db') }, { fetch: wiremockFetch(0).fn })
    rt.reconciler?.stop()
    expect(rt.config.storeDriver).toBe('sqlite')
    expect(await rt.stores.ping()).toBe(true)
    expect((await rt.stores.users.listUsers()).map((u) => u.username)).toEqual(['root'])
    await rt.stores.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('boots without ADMIN_USER / ADMIN_PASSWORD: no account is made, and the log says how to make one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wmui-boot-'))
  const { REDIS_URL: _r, ADMIN_USER: _u, ADMIN_PASSWORD: _p, ...noAdmin } = env
  const warn = vi.spyOn(logger, 'warn')
  try {
    const rt = await bootRuntime({ ...noAdmin, SQLITE_PATH: join(dir, 'ui.db') }, { fetch: wiremockFetch(0).fn })
    rt.reconciler?.stop()
    expect(await rt.stores.users.countUsers()).toBe(0)
    expect(warn.mock.calls.some((c) => String(c[1]).includes('wiremock-ui create-admin'))).toBe(true)
    await rt.stores.close()
  } finally {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an SQLITE_PATH that cannot be opened fails boot at once with a ConfigError', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wmui-boot-'))
  writeFileSync(join(dir, 'file'), 'not a folder')
  let slept = 0
  try {
    await expect(
      bootRuntime(
        { ...env, STORE_DRIVER: 'sqlite', SQLITE_PATH: join(dir, 'file', 'ui.db') },
        { fetch: wiremockFetch(0).fn, sleep: async () => void slept++ },
      ),
    ).rejects.toThrow(/Cannot open SQLITE_PATH/)
    expect(slept).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
