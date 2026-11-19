import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { ConflictError } from '../../../src/server/errors'
import { createRedis } from '../../../src/server/store/connection'
import type { User } from '../../../src/server/users/types'
import { RedisUserStore } from '../../../src/server/users/store'
import { startRedis } from '../../helpers/containers'

let handle: Awaited<ReturnType<typeof startRedis>>
let redis: Redis
let store: RedisUserStore

const mk = (id: string, username: string, over: Partial<User> = {}): User => ({
  id,
  username,
  displayName: username,
  role: 'tester',
  passwordHash: 'hash',
  disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

beforeAll(async () => {
  handle = await startRedis()
  redis = createRedis(handle.url)
  store = new RedisUserStore(redis)
})
afterAll(async () => {
  await redis.quit()
  await handle.stop()
})
beforeEach(async () => {
  await redis.flushdb()
})

test('create, get by id and by name (case-insensitive), list sorted', async () => {
  await store.createUser(mk('2', 'zed'))
  await store.createUser(mk('1', 'Alice'))
  expect((await store.getUser('1'))?.username).toBe('Alice')
  expect((await store.getUserByName('ALICE'))?.id).toBe('1')
  expect((await store.getUserByName('nobody'))).toBeNull()
  expect((await store.listUsers()).map((u) => u.username)).toEqual(['Alice', 'zed'])
  expect(await store.countUsers()).toBe(2)
})

test('duplicate username (any case) is ConflictError "Username already exists"', async () => {
  await store.createUser(mk('1', 'alice'))
  const err = await store.createUser(mk('2', 'ALICE')).catch((e) => e)
  expect(err).toBeInstanceOf(ConflictError)
  expect(err.message).toBe('Username already exists')
  expect(await store.getUser('2')).toBeNull()
  expect(await store.countUsers()).toBe(1)
})

test('rename keeps by-name index in sync; old name no longer resolves', async () => {
  const u = mk('1', 'alice')
  await store.createUser(u)
  await store.updateUser({ ...u, username: 'Alicia' })
  expect(await store.getUserByName('alice')).toBeNull()
  expect((await store.getUserByName('alicia'))?.id).toBe('1')
  await store.createUser(mk('2', 'alice'))
  await expect(store.updateUser({ ...mk('2', 'alice'), username: 'ALICIA' })).rejects.toBeInstanceOf(ConflictError)
})

test('session expires: TTL on session:{id} is in (43100, 43200]', async () => {
  const s = await store.createSession('u1', 43200)
  expect(s.id).not.toBe(s.csrfToken)
  expect(Buffer.from(s.id, 'base64url')).toHaveLength(32)
  const ttl = await redis.ttl(`session:${s.id}`)
  expect(ttl).toBeGreaterThan(43100)
  expect(ttl).toBeLessThanOrEqual(43200)
  expect(await store.getSession(s.id)).toEqual(s)
  await store.deleteSession(s.id)
  expect(await store.getSession(s.id)).toBeNull()
})

test('deleteUser removes its sessions', async () => {
  await store.createUser(mk('1', 'alice'))
  const s = await store.createSession('1', 600)
  await store.deleteUser('1')
  expect(await store.getUser('1')).toBeNull()
  expect(await store.getUserByName('alice')).toBeNull()
  expect(await store.getSession(s.id)).toBeNull()
  expect(await redis.exists('user:1:sessions')).toBe(0)
})

test('hitRateLimit counts and sets the window once', async () => {
  expect(await store.hitRateLimit('1.2.3.4', 900)).toBe(1)
  await redis.expire('ratelimit:login:1.2.3.4', 500)
  expect(await store.hitRateLimit('1.2.3.4', 900)).toBe(2)
  expect(await store.hitRateLimit('1.2.3.4', 900)).toBe(3)
  const ttl = await redis.ttl('ratelimit:login:1.2.3.4')
  expect(ttl).toBeLessThanOrEqual(500)
  expect(ttl).toBeGreaterThan(0)
})
