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
  expect(() => loadConfig(rest)).toThrow(/REDIS_URL/)
})
test('rejects sqlite until milestone 5', () => {
  expect(() => loadConfig({ ...base, STORE_DRIVER: 'sqlite' })).toThrow(/sqlite.*not available yet/i)
})
test('rejects non-positive SYNC_INTERVAL_SECONDS', () => {
  expect(() => loadConfig({ ...base, SYNC_INTERVAL_SECONDS: '0' })).toThrow(/SYNC_INTERVAL_SECONDS/)
})
