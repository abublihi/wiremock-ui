import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { ConfigError } from '../../../src/server/errors'
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
