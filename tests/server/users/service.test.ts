import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { RedisAuditLog } from '../../../src/server/audit/log'
import type { Config } from '../../../src/server/config'
import { createRedis } from '../../../src/server/store/connection'
import { UserService } from '../../../src/server/users/service'
import { RedisUserStore } from '../../../src/server/users/store'
import { startRedis } from '../../helpers/containers'

let handle: Awaited<ReturnType<typeof startRedis>>
let redis: Redis
let store: RedisUserStore
let audit: RedisAuditLog
let svc: UserService
const config = {} as Config

beforeAll(async () => {
  handle = await startRedis()
  redis = createRedis(handle.url)
  store = new RedisUserStore(redis)
  audit = new RedisAuditLog(redis)
  svc = new UserService({ users: store, audit, hashCost: 4 })
})
afterAll(async () => {
  await redis.quit()
  await handle.stop()
})
beforeEach(async () => {
  await redis.flushdb()
})

const admin = () => svc.ensureFirstAdmin('root', 'rootpass1')
const rootId = async () => (await svc.list())[0]!.id

test('ensureFirstAdmin creates once, then reports exists without changing the password', async () => {
  expect(await admin()).toBe('created')
  expect(await svc.ensureFirstAdmin('root', 'different-pass')).toBe('exists')
  await svc.login('root', 'rootpass1', '1.1.1.1', config)
  await expect(svc.login('root', 'different-pass', '1.1.1.1', config)).rejects.toMatchObject({ status: 401 })
})

test('login wrong password and unknown user give the same 401 message', async () => {
  await admin()
  const a = await svc.login('root', 'bad-password', '1.1.1.1', config).catch((e) => e)
  const b = await svc.login('ghost', 'bad-password', '1.1.1.1', config).catch((e) => e)
  expect(a.status).toBe(401)
  expect(b.status).toBe(401)
  expect(a.message).toBe('Invalid username or password')
  expect(b.message).toBe(a.message)
})

test('disabled user cannot log in (same 401)', async () => {
  await admin()
  const u = await svc.create({ username: 'bob', password: 'bobpass12' }, 'root')
  await svc.update(u.id, { disabled: true }, 'root')
  await expect(svc.login('bob', 'bobpass12', '1.1.1.1', config)).rejects.toMatchObject({ status: 401, message: 'Invalid username or password' })
})

test('rate limit: failures only — 15 successes pass; after 10 failures the right password → 429', async () => {
  await admin()
  for (let i = 0; i < 15; i++) await svc.login('root', 'rootpass1', '2.2.2.2', config)
  for (let i = 0; i < 10; i++) await expect(svc.login('root', 'wrong-pass', '2.2.2.2', config)).rejects.toMatchObject({ status: 401 })
  await expect(svc.login('root', 'rootpass1', '2.2.2.2', config)).rejects.toMatchObject({ status: 429, message: 'Too many login attempts; try again later' })
  await svc.login('root', 'rootpass1', '3.3.3.3', config)
})

test('the last active user cannot be disabled or removed (409)', async () => {
  await admin()
  const id = await rootId()
  await expect(svc.update(id, { disabled: true }, 'root')).rejects.toMatchObject({ status: 409, message: 'At least one active user is required' })
  await expect(svc.remove(id, 'root')).rejects.toMatchObject({ status: 409, message: 'At least one active user is required' })
  const second = await svc.create({ username: 'two', password: 'twopass12' }, 'root')
  await svc.update(id, { disabled: true }, 'root')
  await expect(svc.remove(second.id, 'root')).rejects.toMatchObject({ status: 409 })
  await expect(svc.update(second.id, { disabled: true }, 'root')).rejects.toMatchObject({ status: 409 })
})

test('password change and disable end existing sessions', async () => {
  await admin()
  const u = await svc.create({ username: 'bob', password: 'bobpass12' }, 'root')
  const s1 = (await svc.login('bob', 'bobpass12', '1.1.1.1', config)).session
  await svc.update(u.id, { password: 'newpass123' }, 'root')
  expect(await store.getSession(s1.id)).toBeNull()
  const s2 = (await svc.login('bob', 'newpass123', '1.1.1.1', config)).session
  await svc.update(u.id, { disabled: true }, 'root')
  expect(await store.getSession(s2.id)).toBeNull()
})

test('ensureFirstAdmin rejects bad ADMIN_USER / ADMIN_PASSWORD and audits creation as system', async () => {
  await expect(svc.ensureFirstAdmin('root', 'short')).rejects.toMatchObject({ status: 500, message: expect.stringContaining('ADMIN_PASSWORD') })
  await expect(svc.ensureFirstAdmin('baseline', 'rootpass1')).rejects.toMatchObject({ message: expect.stringContaining('ADMIN_USER') })
  await admin()
  expect((await audit.list()).entries).toMatchObject([{ actor: 'system', action: 'user.create', target: 'root' }])
})

test('changeOwnPassword keeps the current session, ends others, and audits user.password', async () => {
  await admin()
  const a = await svc.login('root', 'rootpass1', '1.1.1.1', config)
  const b = await svc.login('root', 'rootpass1', '1.1.1.1', config)
  await svc.changeOwnPassword(a.user.id, 'rootpass1', 'brandnew12', a.session.id)
  expect(await store.getSession(a.session.id)).not.toBeNull()
  expect(await store.getSession(b.session.id)).toBeNull()
  const entries = (await audit.list()).entries
  expect(entries.some((e) => e.action === 'user.password' && e.target === 'root')).toBe(true)
  expect(JSON.stringify(entries)).not.toContain('brandnew12')
})

test('logout deletes the session; changeOwnPassword checks the current one', async () => {
  await admin()
  const { session, user } = await svc.login('root', 'rootpass1', '1.1.1.1', config)
  await svc.logout(session.id)
  expect(await store.getSession(session.id)).toBeNull()
  await expect(svc.changeOwnPassword(user.id, 'wrong', 'brandnew12')).rejects.toMatchObject({ status: 400, message: 'Current password is incorrect' })
  await svc.changeOwnPassword(user.id, 'rootpass1', 'brandnew12')
  await svc.login('root', 'brandnew12', '1.1.1.1', config)
})

test('reserved usernames, bad usernames, short/long passwords rejected (400)', async () => {
  await admin()
  const base = { password: 'longenough1' }
  for (const username of ['baseline', 'System', 'a', 'has space']) {
    await expect(svc.create({ ...base, username }, 'root')).rejects.toMatchObject({ status: 400 })
  }
  await expect(svc.create({ ...base, username: 'okname', password: 'short' }, 'root')).rejects.toMatchObject({ status: 400, message: 'password must be 8–72 characters' })
  await expect(svc.create({ ...base, username: 'okname', password: 'x'.repeat(73) }, 'root')).rejects.toMatchObject({ status: 400 })
  expect((await svc.create({ ...base, username: 'MixedCase' }, 'root')).username).toBe('mixedcase')
})

test('audit entries written for create/update/delete without password values', async () => {
  await admin()
  const u = await svc.create({ username: 'bob', password: 'bobpass12' }, 'root')
  await svc.update(u.id, { password: 'newpass123', displayName: 'Bob' }, 'root')
  await svc.remove(u.id, 'root')
  const entries = (await audit.list()).entries.filter((e) => e.actor === 'root')
  expect(entries.map((e) => e.action).sort()).toEqual(['user.create', 'user.delete', 'user.update'])
  const text = JSON.stringify(entries)
  expect(text).not.toContain('bobpass12')
  expect(text).not.toContain('newpass123')
  expect(entries.every((e) => e.actor === 'root' && e.target === 'bob')).toBe(true)
})

test('no UserService return value contains passwordHash', async () => {
  await admin()
  const created = await svc.create({ username: 'bob', password: 'bobpass12' }, 'root')
  const updated = await svc.update(created.id, { displayName: 'B' }, 'root')
  const login = await svc.login('bob', 'bobpass12', '1.1.1.1', config)
  for (const v of [created, updated, login, await svc.list()]) expect(JSON.stringify(v)).not.toContain('passwordHash')
})
