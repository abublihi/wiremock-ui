import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { ConflictError, NotFoundError } from '../../../src/server/errors'
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

test('concurrent renames of one user leave exactly one by-name key pointing at it', async () => {
  const u = mk('1', 'alice')
  await store.createUser(u)
  await Promise.allSettled([
    store.updateUser({ ...u, username: 'bob' }),
    store.updateUser({ ...u, username: 'carol' }),
  ])
  const keys = await redis.keys('users:by-name:*')
  expect(keys).toHaveLength(1)
  expect(await redis.get(keys[0] as string)).toBe('1')
  expect(keys[0]).toBe(`users:by-name:${(await store.getUser('1'))?.username}`)
})

test('case-only rename works', async () => {
  const u = mk('1', 'alice')
  await store.createUser(u)
  await store.updateUser({ ...u, username: 'Alice' })
  expect((await store.getUserByName('alice'))?.username).toBe('Alice')
  expect(await redis.keys('users:by-name:*')).toEqual(['users:by-name:alice'])
})

test('updating a nonexistent user throws NotFoundError and creates nothing', async () => {
  await expect(store.updateUser(mk('9', 'ghost'))).rejects.toBeInstanceOf(NotFoundError)
  expect(await redis.keys('*')).toEqual([])
})

test('releaseRateLimit decrements but never below 0; deleteOtherSessions keeps one', async () => {
  await store.hitRateLimit('9.9.9.9', 900)
  await store.hitRateLimit('9.9.9.9', 900)
  await store.releaseRateLimit('9.9.9.9')
  expect(await redis.get('ratelimit:login:9.9.9.9')).toBe('1')
  await store.releaseRateLimit('9.9.9.9')
  await store.releaseRateLimit('9.9.9.9')
  await store.releaseRateLimit('8.8.8.8')
  expect(await redis.get('ratelimit:login:9.9.9.9')).toBe('0')
  expect(await redis.exists('ratelimit:login:8.8.8.8')).toBe(0)
  const a = await store.createSession('u', 60)
  const b = await store.createSession('u', 60)
  await store.deleteOtherSessions('u', a.id)
  expect(await store.getSession(a.id)).not.toBeNull()
  expect(await store.getSession(b.id)).toBeNull()
})

test('hitRateLimit sets the window on a key that has no TTL', async () => {
  await redis.set('ratelimit:login:7.7.7.7', '4')
  expect(await store.hitRateLimit('7.7.7.7', 900)).toBe(5)
  const ttl = await redis.ttl('ratelimit:login:7.7.7.7')
  expect(ttl).toBeGreaterThan(0)
  expect(ttl).toBeLessThanOrEqual(900)
})
