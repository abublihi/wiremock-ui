import { expect, test } from 'vitest'
import { MEMORY_AUDIT_MAX, MemoryAuditLog, MemoryCatalogStore, MemoryUserStore, NO_USER_MANAGEMENT } from '../../../src/server/store/memory'
import type { User } from '../../../src/server/users/types'

const user = (id: string, username: string): User => ({
  id,
  username,
  displayName: username,
  role: 'admin',
  passwordHash: 'x',
  disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

test('MemoryUserStore holds the bootstrap account only: later creates, updates and deletes are 400', async () => {
  const s = new MemoryUserStore()
  await s.createUser(user('1', 'Root'))
  expect(await s.countUsers()).toBe(1)
  expect((await s.getUserByName('root'))?.id).toBe('1')
  expect(await s.getUser('1')).toMatchObject({ username: 'Root' })
  await expect(s.createUser(user('2', 'other'))).rejects.toMatchObject({ status: 400, message: NO_USER_MANAGEMENT })
  await expect(s.createUser(user('3', 'root'))).rejects.toMatchObject({ status: 409 })
  await expect(s.updateUser(user('1', 'root'))).rejects.toMatchObject({ status: 400, message: NO_USER_MANAGEMENT })
  await expect(s.deleteUser('1')).rejects.toMatchObject({ status: 400, message: NO_USER_MANAGEMENT })
  expect((await s.listUsers()).map((u) => u.id)).toEqual(['1'])
})

test('MemoryUserStore sessions: create, read, expire, delete one, all, or all but one', async () => {
  const s = new MemoryUserStore()
  const a = await s.createSession('u1', 60)
  const b = await s.createSession('u1', 60)
  const c = await s.createSession('u2', 60)
  expect(await s.getSession(a.id)).toEqual(a)
  expect(a.csrfToken).not.toBe(b.csrfToken)
  await s.deleteOtherSessions('u1', a.id)
  expect(await s.getSession(a.id)).not.toBeNull()
  expect(await s.getSession(b.id)).toBeNull()
  await s.deleteSessionsOf('u1')
  expect(await s.getSession(a.id)).toBeNull()
  await s.deleteSession(c.id)
  expect(await s.getSession(c.id)).toBeNull()
  const gone = await s.createSession('u3', 0)
  expect(await s.getSession(gone.id)).toBeNull()
})

test('MemoryUserStore rate limit counts per ip, releases never below 0, and resets after the window', async () => {
  const s = new MemoryUserStore()
  expect(await s.hitRateLimit('1.1.1.1', 60)).toBe(1)
  expect(await s.hitRateLimit('1.1.1.1', 60)).toBe(2)
  expect(await s.hitRateLimit('2.2.2.2', 60)).toBe(1)
  await s.releaseRateLimit('1.1.1.1')
  await s.releaseRateLimit('1.1.1.1')
  await s.releaseRateLimit('1.1.1.1')
  expect(await s.hitRateLimit('1.1.1.1', 60)).toBe(1)
  expect(await s.hitRateLimit('3.3.3.3', 0)).toBe(1)
  expect(await s.hitRateLimit('3.3.3.3', 0)).toBe(1)
})

test('MemoryAuditLog keeps the last 500 entries, newest first, paged by cursor', async () => {
  const log = new MemoryAuditLog()
  for (let i = 0; i < MEMORY_AUDIT_MAX + 20; i++) await log.record({ actor: 'a', action: 'x', target: String(i) })
  const first = await log.list({ limit: 300 })
  expect(first.entries).toHaveLength(300)
  expect(first.entries[0]).toMatchObject({ actor: 'a', action: 'x', target: String(MEMORY_AUDIT_MAX + 19) })
  expect(typeof first.entries[0].at).toBe('string')
  const second = await log.list({ limit: 300, cursor: first.nextCursor! })
  expect(second.entries).toHaveLength(200)
  expect(second.nextCursor).toBeNull()
  expect(second.entries.at(-1)?.target).toBe('20')
  expect(new Set([...first.entries, ...second.entries].map((e) => e.target)).size).toBe(MEMORY_AUDIT_MAX)
  expect((await log.list()).entries).toHaveLength(100)
  await expect(log.list({ cursor: 'bad' })).rejects.toMatchObject({ status: 400 })
})

test('MemoryCatalogStore: upsert, create-only insert, sorted lists, cascade delete', async () => {
  const c = new MemoryCatalogStore()
  const i = (key: string) => ({ key, name: key, prefix: `/${key}`, updatedAt: 't', updatedBy: 'u' })
  const e = (integration: string, key: string, name = key) => ({
    integration,
    key,
    name,
    method: 'GET',
    path: '/x',
    pathType: 'exact' as const,
    contentType: 'json' as const,
    exampleResponses: {},
    allowedStatuses: [200],
    updatedAt: 't',
    updatedBy: 'u',
  })
  await c.putIntegration(i('b'))
  expect(await c.insertIntegration(i('a'))).toBe(true)
  expect(await c.insertIntegration({ ...i('a'), name: 'other' })).toBe(false)
  expect((await c.listIntegrations()).map((x) => x.key)).toEqual(['a', 'b'])
  await c.putEndpoint(e('a', 'z'))
  expect(await c.insertEndpoint(e('a', 'y'))).toBe(true)
  expect(await c.insertEndpoint(e('a', 'y', 'other'))).toBe(false)
  await c.putEndpoint(e('b', 'y'))
  expect((await c.listEndpoints('a')).map((x) => x.key)).toEqual(['y', 'z'])
  expect((await c.getEndpoint('a', 'y'))?.name).toBe('y')
  await c.deleteEndpoint('a', 'z')
  await c.deleteIntegration('a')
  expect(await c.getIntegration('a')).toBeNull()
  expect(await c.getEndpoint('a', 'y')).toBeNull()
  expect((await c.listEndpoints('b')).map((x) => x.key)).toEqual(['y'])
})

test('memory stores hand out copies: changing what was read or written does not change the store', async () => {
  const { MemoryCatalogStore, MemoryUserStore } = await import('../../../src/server/store/memory')
  const catalog = new MemoryCatalogStore()
  const integration = { key: 'pay', name: 'Pay', prefix: '/pay' } as never as Parameters<typeof catalog.putIntegration>[0]
  await catalog.putIntegration(integration)
  ;(integration as { name: string }).name = 'changed after put'
  const read = (await catalog.getIntegration('pay'))!
  read.name = 'changed after get'
  expect((await catalog.getIntegration('pay'))!.name).toBe('Pay')

  const users = new MemoryUserStore()
  const ts = new Date().toISOString()
  await users.createUser({ id: 'u1', username: 'ann', displayName: 'Ann', role: 'admin', passwordHash: 'h', disabled: false, createdAt: ts, updatedAt: ts })
  const ann = (await users.getUser('u1'))!
  ann.disabled = true
  expect((await users.getUser('u1'))!.disabled).toBe(false)
})
