import { expect, test } from 'vitest'
import { loadConfig, loadStoreSettings } from '../../src/server/config'

const base = { ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(32), REDIS_URL: 'redis://r:6379' }
test('applies defaults', () => {
  expect(loadConfig(base)).toMatchObject({ wiremockUrl: 'http://localhost:8080', storeDriver: 'redis', syncIntervalSeconds: 5 })
})
test('lists every missing required var', () => {
  expect(() => loadConfig({})).toThrow(/SESSION_SECRET is required/)
})
test('ADMIN_USER / ADMIN_PASSWORD are optional with a store (create-admin makes the first account), but set together', () => {
  const { ADMIN_USER, ADMIN_PASSWORD, ...rest } = base
  expect(loadConfig(rest)).toMatchObject({ adminUser: undefined, adminPassword: undefined })
  expect(loadConfig({ ...rest, ADMIN_USER: '', ADMIN_PASSWORD: '' })).toMatchObject({ adminUser: undefined })
  expect(() => loadConfig({ ...rest, ADMIN_USER })).toThrow('ADMIN_USER and ADMIN_PASSWORD must be set together')
  expect(() => loadConfig({ ...rest, ADMIN_PASSWORD })).toThrow('ADMIN_USER and ADMIN_PASSWORD must be set together')
})
test('WireMock-only mode still requires ADMIN_USER / ADMIN_PASSWORD: accounts live in memory', () => {
  const { ADMIN_USER, ADMIN_PASSWORD, ...rest } = base
  expect(() => loadConfig({ ...rest, STORE_DRIVER: 'none' })).toThrow(/ADMIN_USER is required in WireMock-only mode.*ADMIN_PASSWORD is required in WireMock-only mode/s)
})
test('loadStoreSettings reads only the store settings, with the same rules', () => {
  expect(loadStoreSettings({})).toEqual({ storeDriver: 'sqlite', redisUrl: undefined, sqlitePath: './data/wiremock-ui.db' })
  expect(loadStoreSettings({ REDIS_URL: 'redis://r:6379', SQLITE_PATH: '' })).toEqual({ storeDriver: 'redis', redisUrl: 'redis://r:6379', sqlitePath: './data/wiremock-ui.db' })
  expect(loadStoreSettings({ STORE_DRIVER: 'sqlite', REDIS_URL: 'redis://r', SQLITE_PATH: '/data/x.db' })).toMatchObject({ storeDriver: 'sqlite', sqlitePath: '/data/x.db' })
  expect(() => loadStoreSettings({ STORE_DRIVER: 'redis' })).toThrow('REDIS_URL is required when STORE_DRIVER=redis')
  expect(() => loadStoreSettings({ STORE_DRIVER: 'mongo' })).toThrow(/STORE_DRIVER must be/)
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
  expect(() => loadConfig({ ...base, STORE_DRIVER: 'mongo' })).toThrow('STORE_DRIVER must be "redis", "sqlite" or "none", got "mongo"')
})
test('STORE_DRIVER=none (WireMock-only mode) must be chosen explicitly and needs no Redis', () => {
  const { REDIS_URL, ...rest } = base
  expect(loadConfig({ ...rest, STORE_DRIVER: 'none' })).toMatchObject({ storeDriver: 'none' })
  expect(loadConfig({ ...base, STORE_DRIVER: 'none' })).toMatchObject({ storeDriver: 'none' })
  expect(loadConfig(rest).storeDriver).toBe('sqlite')
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
test('WIREMOCK_PUBLIC_URL defaults to WIREMOCK_URL and must be an http(s) URL', () => {
  expect(loadConfig(base).wiremockPublicUrl).toBe('http://localhost:8080')
  expect(loadConfig({ ...base, WIREMOCK_URL: 'http://wiremock:8080/' }).wiremockPublicUrl).toBe('http://wiremock:8080')
  expect(loadConfig({ ...base, WIREMOCK_PUBLIC_URL: 'https://mocks.test.example/' }).wiremockPublicUrl).toBe('https://mocks.test.example')
  expect(() => loadConfig({ ...base, WIREMOCK_PUBLIC_URL: 'mocks.test.example' })).toThrow('WIREMOCK_PUBLIC_URL must be an http:// or https:// URL')
  expect(() => loadConfig({ ...base, WIREMOCK_PUBLIC_URL: 'ftp://mocks.test.example' })).toThrow('WIREMOCK_PUBLIC_URL must be an http:// or https:// URL')
})
test('RECORDING_ALLOWED defaults to true; false or 0 turns recording off; anything else is refused', () => {
  expect(loadConfig(base).recordingAllowed).toBe(true)
  expect(loadConfig({ ...base, RECORDING_ALLOWED: 'false' }).recordingAllowed).toBe(false)
  expect(loadConfig({ ...base, RECORDING_ALLOWED: '0' }).recordingAllowed).toBe(false)
  expect(loadConfig({ ...base, RECORDING_ALLOWED: 'TRUE' }).recordingAllowed).toBe(true)
  expect(loadConfig({ ...base, RECORDING_ALLOWED: '' }).recordingAllowed).toBe(true)
  expect(() => loadConfig({ ...base, RECORDING_ALLOWED: 'off' })).toThrow(/RECORDING_ALLOWED/)
})
