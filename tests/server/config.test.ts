import { expect, test } from 'vitest'
import { loadConfig } from '../../src/server/config'

const base = { ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(32), REDIS_URL: 'redis://r:6379' }
test('applies defaults', () => {
  expect(loadConfig(base)).toMatchObject({ wiremockUrl: 'http://localhost:8080', storeDriver: 'redis', syncIntervalSeconds: 5 })
})
test('lists every missing required var', () => {
  expect(() => loadConfig({})).toThrow(/ADMIN_USER.*ADMIN_PASSWORD.*SESSION_SECRET/s)
})
test('requires REDIS_URL for redis driver', () => {
  const { REDIS_URL, ...rest } = base
  expect(() => loadConfig({ ...rest, STORE_DRIVER: 'redis' })).toThrow('REDIS_URL is required when STORE_DRIVER=redis')
})
test('config picks sqlite when REDIS_URL is unset', () => {
  const { REDIS_URL, ...rest } = base
  expect(loadConfig(rest)).toMatchObject({ storeDriver: 'sqlite', sqlitePath: './data/wiremock-ui.db', redisUrl: undefined })
})
test('config picks redis when REDIS_URL is set, unless STORE_DRIVER says otherwise', () => {
  expect(loadConfig(base)).toMatchObject({ storeDriver: 'redis', redisUrl: 'redis://r:6379' })
  expect(loadConfig({ ...base, STORE_DRIVER: 'sqlite', SQLITE_PATH: '/data/x.db' })).toMatchObject({ storeDriver: 'sqlite', sqlitePath: '/data/x.db' })
})
test('rejects an unknown STORE_DRIVER', () => {
  expect(() => loadConfig({ ...base, STORE_DRIVER: 'mongo' })).toThrow('STORE_DRIVER must be "redis" or "sqlite", got "mongo"')
})
test('rejects non-positive SYNC_INTERVAL_SECONDS', () => {
  expect(() => loadConfig({ ...base, SYNC_INTERVAL_SECONDS: '0' })).toThrow(/SYNC_INTERVAL_SECONDS/)
})
test('BOOT_TIMEOUT_SECONDS defaults to 60 and must be a positive integer', () => {
  expect(loadConfig(base).bootTimeoutSeconds).toBe(60)
  expect(loadConfig({ ...base, BOOT_TIMEOUT_SECONDS: '90' }).bootTimeoutSeconds).toBe(90)
  for (const bad of ['0', '-5', '1.5', 'abc']) {
    expect(() => loadConfig({ ...base, BOOT_TIMEOUT_SECONDS: bad })).toThrow(/BOOT_TIMEOUT_SECONDS/)
  }
})
test('WIREMOCK_ADMIN_USER and WIREMOCK_ADMIN_PASSWORD must be set together', () => {
  expect(() => loadConfig({ ...base, WIREMOCK_ADMIN_USER: 'u' })).toThrow(/WIREMOCK_ADMIN_USER.*WIREMOCK_ADMIN_PASSWORD/)
  expect(() => loadConfig({ ...base, WIREMOCK_ADMIN_PASSWORD: 'p' })).toThrow(/WIREMOCK_ADMIN_USER.*WIREMOCK_ADMIN_PASSWORD/)
  expect(() => loadConfig({ ...base, WIREMOCK_ADMIN_USER: 'u', WIREMOCK_ADMIN_PASSWORD: 'p' })).not.toThrow()
  expect(() => loadConfig(base)).not.toThrow()
})
test('parses TRUST_PROXY/SEED_PRUNE booleans and rejects "yes"', () => {
  expect(loadConfig(base)).toMatchObject({ trustProxy: false, seedPrune: false, publicUiUrl: undefined, seedPath: undefined })
  expect(loadConfig({ ...base, TRUST_PROXY: 'TRUE', SEED_PRUNE: '1' })).toMatchObject({ trustProxy: true, seedPrune: true })
  expect(loadConfig({ ...base, TRUST_PROXY: '0', SEED_PRUNE: 'False' })).toMatchObject({ trustProxy: false, seedPrune: false })
  expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
  expect(() => loadConfig({ ...base, SEED_PRUNE: 'yes' })).toThrow(/SEED_PRUNE/)
  expect(loadConfig({ ...base, PUBLIC_UI_URL: 'https://ui.example', SEED_PATH: '/seed' })).toMatchObject({ publicUiUrl: 'https://ui.example', seedPath: '/seed' })
})
