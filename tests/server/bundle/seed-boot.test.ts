import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import { ConfigError } from '../../../src/server/errors'
import { logger } from '../../../src/server/logger'
import { bootRuntime } from '../../../src/server/runtime'
import { startRedis, startWireMock } from '../../helpers/containers'

test('SEED_PATH folder is imported at boot; a bad seed fails the boot', async () => {
  const wm = await startWireMock()
  const redis = await startRedis()
  const env = {
    WIREMOCK_URL: wm.url,
    WIREMOCK_ADMIN_USER: wm.user,
    WIREMOCK_ADMIN_PASSWORD: wm.password,
    REDIS_URL: redis.url,
    ADMIN_USER: 'ui-admin',
    ADMIN_PASSWORD: 'ui-admin-pass',
    SESSION_SECRET: 'x',
  }
  try {
    const rt = await bootRuntime({ ...env, SEED_PATH: resolve('tests/fixtures/bundle') })
    try {
      expect((await rt.catalog.listEndpoints('seedpay')).map((e) => e.key)).toEqual(['get-charge'])
      const [mock] = await rt.mocks.list({ integration: 'seedpay' })
      expect(mock.metadata?.wiremockUi).toMatchObject({ owner: 'baseline', source: 'seed', updatedBy: 'system' })
      expect(await (await fetch(`${wm.url}/seedpay/charges/1`)).text()).toBe('seeded')
    } finally {
      rt.reconciler.stop()
      await rt.stores.close()
    }
    await expect(bootRuntime({ ...env, SEED_PATH: resolve('tests/fixtures/missing') })).rejects.toBeInstanceOf(ConfigError)
  } finally {
    await redis.stop()
    await wm.stop().catch(() => {})
  }
})

test('seeding a baseline mock leaves an existing tester mock with the same matcher on top; id-less seed mocks warn', async () => {
  const wm = await startWireMock()
  const redis = await startRedis()
  const env = {
    WIREMOCK_URL: wm.url,
    WIREMOCK_ADMIN_USER: wm.user,
    WIREMOCK_ADMIN_PASSWORD: wm.password,
    REDIS_URL: redis.url,
    ADMIN_USER: 'ui-admin',
    ADMIN_PASSWORD: 'ui-admin-pass',
    SESSION_SECRET: 'x',
  }
  const warn = vi.spyOn(logger, 'warn')
  try {
    const first = await bootRuntime(env)
    const tester = await first.users.create({ username: 'seed-tester', role: 'tester', password: 'password-1' }, 'ui-admin')
    await first.mocks.create({ request: { method: 'GET', urlPath: '/seedpay/charges/1' }, response: { status: 200, body: 'mine' } }, tester)
    first.reconciler.stop()
    await first.stores.close()
    expect(warn.mock.calls.some(([, msg]) => String(msg).includes('content-derived'))).toBe(false)

    // The UI restarts with a seed while WireMock keeps its stubs.
    const second = await bootRuntime({ ...env, SEED_PATH: resolve('tests/fixtures/bundle') })
    try {
      expect((await second.mocks.list({ integration: 'seedpay' })).some((m) => m.metadata?.wiremockUi?.owner === 'baseline')).toBe(true)
      expect(await (await fetch(`${wm.url}/seedpay/charges/1`)).text()).toBe('mine')
      const hint = warn.mock.calls.find(([, msg]) => String(msg).includes('content-derived'))
      expect(hint?.[0]).toMatchObject({ count: 1 })
    } finally {
      second.reconciler.stop()
      await second.stores.close()
    }
    warn.mockClear()
    const pruned = await bootRuntime({ ...env, SEED_PATH: resolve('tests/fixtures/bundle'), SEED_PRUNE: 'true' })
    pruned.reconciler.stop()
    await pruned.stores.close()
    expect(warn.mock.calls.some(([, msg]) => String(msg).includes('content-derived'))).toBe(false)
  } finally {
    warn.mockRestore()
    await redis.stop()
    await wm.stop().catch(() => {})
  }
})
