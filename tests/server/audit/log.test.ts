import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { RedisAuditLog } from '../../../src/server/audit/log'
import { createRedis } from '../../../src/server/store/connection'
import { startRedis } from '../../helpers/containers'

let handle: Awaited<ReturnType<typeof startRedis>>
let redis: Redis
let log: RedisAuditLog

beforeAll(async () => {
  handle = await startRedis()
  redis = createRedis(handle.url)
  log = new RedisAuditLog(redis)
})
afterAll(async () => {
  vi.useRealTimers()
  await redis.quit()
  await handle.stop()
})
beforeEach(async () => {
  vi.useRealTimers()
  await redis.flushdb()
})

test('audit list newest first, respects limit and before', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  for (const [i, action] of ['a', 'b', 'c'].entries()) {
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 1, 0, 0, i)))
    await log.record({ actor: 'sara', action, target: 't', details: { n: i } })
  }
  vi.useRealTimers()
  const all = await log.list()
  expect(all.map((e) => e.action)).toEqual(['c', 'b', 'a'])
  expect(all[0]).toMatchObject({ actor: 'sara', target: 't', details: { n: 2 }, at: '2026-11-01T00:00:02.000Z' })
  expect((await log.list({ limit: 2 })).map((e) => e.action)).toEqual(['c', 'b'])
  expect((await log.list({ before: '2026-11-01T00:00:02.000Z' })).map((e) => e.action)).toEqual(['b', 'a'])
})

test('audit drops entries older than 30 days on write', async () => {
  const old = Date.now() - 31 * 86_400_000
  await redis.zadd('audit:log', old, JSON.stringify({ at: new Date(old).toISOString(), actor: 'x', action: 'old' }))
  await log.record({ actor: 'sara', action: 'new' })
  expect((await log.list()).map((e) => e.action)).toEqual(['new'])
  expect(await redis.zcard('audit:log')).toBe(1)
})

test('entries with identical content are kept separately', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'))
  await log.record({ actor: 'sara', action: 'same' })
  await log.record({ actor: 'sara', action: 'same' })
  expect(await log.list()).toHaveLength(2)
})
