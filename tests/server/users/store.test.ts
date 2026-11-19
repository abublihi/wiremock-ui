import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { ConflictError, NotFoundError } from '../../../src/server/errors'
import type { User, UserStore } from '../../../src/server/users/types'
import { drivers, type StoreHarness } from '../../helpers/stores'

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

describe.each(drivers)('UserStore on %s', (_driver, start) => {
  let h: StoreHarness
  let store: UserStore

  beforeAll(async () => {
    h = await start()
    store = h.stores.users
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(async () => {
    await h.probe.reset()
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
    const err = await store.updateUser({ ...mk('2', 'alice'), username: 'ALICIA' }).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toBe('Username already exists')
  })

  test('session expires: TTL on the session is in (43100, 43200]', async () => {
    const s = await store.createSession('u1', 43200)
    expect(s.id).not.toBe(s.csrfToken)
    expect(Buffer.from(s.id, 'base64url')).toHaveLength(32)
    const ttl = await h.probe.sessionTtl(s.id)
    expect(ttl).toBeGreaterThan(43100)
    expect(ttl).toBeLessThanOrEqual(43200)
    expect(await store.getSession(s.id)).toEqual(s)
    await store.deleteSession(s.id)
    expect(await store.getSession(s.id)).toBeNull()
  })

  test('a session is gone once its TTL passes', async () => {
    const s = await store.createSession('u1', 1)
    expect(await store.getSession(s.id)).toEqual(s)
    await new Promise((r) => setTimeout(r, 1100))
    expect(await store.getSession(s.id)).toBeNull()
  })

  test('deleteUser removes its sessions', async () => {
    await store.createUser(mk('1', 'alice'))
    const s = await store.createSession('1', 600)
    await store.deleteUser('1')
    expect(await store.getUser('1')).toBeNull()
    expect(await store.getUserByName('alice')).toBeNull()
    expect(await store.getSession(s.id)).toBeNull()
    expect(await h.probe.userSessionsExist('1')).toBe(false)
  })

  test('hitRateLimit counts and sets the window once', async () => {
    expect(await store.hitRateLimit('1.2.3.4', 900)).toBe(1)
    await h.probe.setRateLimitTtl('1.2.3.4', 500)
    expect(await store.hitRateLimit('1.2.3.4', 900)).toBe(2)
    expect(await store.hitRateLimit('1.2.3.4', 900)).toBe(3)
    const ttl = await h.probe.rateLimitTtl('1.2.3.4')
    expect(ttl).toBeLessThanOrEqual(500)
    expect(ttl).toBeGreaterThan(0)
  })

  test('the rate-limit counter starts again after its window', async () => {
    expect(await store.hitRateLimit('5.5.5.5', 1)).toBe(1)
    expect(await store.hitRateLimit('5.5.5.5', 1)).toBe(2)
    await new Promise((r) => setTimeout(r, 1100))
    expect(await store.hitRateLimit('5.5.5.5', 1)).toBe(1)
  })

  test('concurrent renames of one user leave exactly one by-name key pointing at it', async () => {
    const u = mk('1', 'alice')
    await store.createUser(u)
    await Promise.allSettled([
      store.updateUser({ ...u, username: 'bob' }),
      store.updateUser({ ...u, username: 'carol' }),
    ])
    const index = await h.probe.nameIndex()
    expect(index).toHaveLength(1)
    expect(index[0]).toEqual({ name: (await store.getUser('1'))?.username, id: '1' })
  })

  test('case-only rename works', async () => {
    const u = mk('1', 'alice')
    await store.createUser(u)
    await store.updateUser({ ...u, username: 'Alice' })
    expect((await store.getUserByName('alice'))?.username).toBe('Alice')
    expect(await h.probe.nameIndex()).toEqual([{ name: 'alice', id: '1' }])
  })

  test('updating a nonexistent user throws NotFoundError and creates nothing', async () => {
    const err = await store.updateUser(mk('9', 'ghost')).catch((e) => e)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.message).toBe('User not found')
    expect(await h.probe.isEmpty()).toBe(true)
  })

  test('releaseRateLimit decrements but never below 0; deleteOtherSessions keeps one', async () => {
    await store.hitRateLimit('9.9.9.9', 900)
    await store.hitRateLimit('9.9.9.9', 900)
    await store.releaseRateLimit('9.9.9.9')
    expect(await h.probe.rateLimit('9.9.9.9')).toBe('1')
    await store.releaseRateLimit('9.9.9.9')
    await store.releaseRateLimit('9.9.9.9')
    await store.releaseRateLimit('8.8.8.8')
    expect(await h.probe.rateLimit('9.9.9.9')).toBe('0')
    expect(await h.probe.rateLimit('8.8.8.8')).toBeNull()
    const a = await store.createSession('u', 60)
    const b = await store.createSession('u', 60)
    await store.deleteOtherSessions('u', a.id)
    expect(await store.getSession(a.id)).not.toBeNull()
    expect(await store.getSession(b.id)).toBeNull()
  })

  test('hitRateLimit sets the window on a key that has no TTL', async () => {
    await h.probe.setRateLimitNoTtl('7.7.7.7', 4)
    expect(await store.hitRateLimit('7.7.7.7', 900)).toBe(5)
    const ttl = await h.probe.rateLimitTtl('7.7.7.7')
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(900)
  })
})
