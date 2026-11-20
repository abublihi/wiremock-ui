import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { assertCsrf, authenticate } from '../../../src/server/auth/authenticate'
import { signSessionId } from '../../../src/server/auth/session'
import type { Config } from '../../../src/server/config'
import { hashPassword, verifyPasswordOrDummy } from '../../../src/server/users/passwords'
import type { User, UserStore } from '../../../src/server/users/types'
import { drivers, type StoreHarness } from '../../helpers/stores'

const config = { trustProxy: false, sessionSecret: 'sek' } as Config

const basic = (name: string, pw: string, method = 'GET') =>
  new Request('http://x/', { method, headers: { authorization: `Basic ${Buffer.from(`${name}:${pw}`).toString('base64')}` } })
const cookie = (id: string, method = 'GET', extra: Record<string, string> = {}) =>
  new Request('http://x/', { method, headers: { cookie: `wmui_session=${signSessionId(id, config.sessionSecret)}`, ...extra } })

describe.each(drivers)('authenticate on %s', (_driver, start) => {
  let h: StoreHarness
  let users: UserStore
  const deps = () => ({ users, config })

  const mk = async (over: Partial<User> = {}): Promise<User> => {
    const user: User = {
      id: 'u1', username: 'alice', displayName: 'Alice', role: 'tester',
      passwordHash: await hashPassword('password1', 4), disabled: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
    }
    await users.createUser(user)
    return user
  }

  beforeAll(async () => {
    h = await start()
    users = h.stores.users
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(async () => {
    await h.probe.reset()
  })

  test('valid session cookie → principal via session, without passwordHash', async () => {
    const u = await mk()
    const s = await users.createSession(u.id, 60)
    const p = await authenticate(cookie(s.id), deps())
    expect(p.via).toBe('session')
    expect(p.user.username).toBe('alice')
    expect(p.session?.id).toBe(s.id)
    expect(JSON.stringify(p)).not.toContain('passwordHash')
  })

  test('expired, deleted, or unsigned session → 401', async () => {
    const u = await mk()
    const s = await users.createSession(u.id, 1)
    await h.probe.deleteSessionRecord(s.id)
    await expect(authenticate(cookie(s.id), deps())).rejects.toMatchObject({ status: 401 })
    const s2 = await users.createSession(u.id, 60)
    await expect(authenticate(new Request('http://x/', { headers: { cookie: `wmui_session=${s2.id}` } }), deps())).rejects.toMatchObject({ status: 401 })
    await expect(authenticate(new Request('http://x/'), deps())).rejects.toMatchObject({ status: 401, message: 'Authentication required' })
  })

  test('session of a deleted user → 401', async () => {
    const u = await mk()
    const s = await users.createSession(u.id, 60)
    await h.probe.deleteUserRecord(u.id)
    await expect(authenticate(cookie(s.id), deps())).rejects.toMatchObject({ status: 401 })
  })

  test('basic auth against a user account → principal via basic; wrong password → 401', async () => {
    await mk()
    const p = await authenticate(basic('Alice', 'password1'), deps())
    expect(p).toMatchObject({ via: 'basic', user: { username: 'alice' } })
    await expect(authenticate(basic('alice', 'nope'), deps())).rejects.toMatchObject({ status: 401 })
    await expect(authenticate(basic('ghost', 'password1'), deps())).rejects.toMatchObject({ status: 401 })
  })

  test('disabled user → 401 for both session and basic', async () => {
    const u = await mk({ disabled: true })
    const s = await users.createSession(u.id, 60)
    await expect(authenticate(cookie(s.id), deps())).rejects.toMatchObject({ status: 401 })
    await expect(authenticate(basic('alice', 'password1'), deps())).rejects.toMatchObject({ status: 401 })
  })

  test('basic auth counts only failed attempts: 12 successes pass; 10 failures then a correct password → 429', async () => {
    await mk()
    for (let i = 0; i < 12; i++) await authenticate(basic('alice', 'password1'), deps())
    await h.probe.reset()
    await mk()
    for (let i = 0; i < 10; i++) await authenticate(basic('alice', 'wrong'), deps()).catch(() => {})
    await expect(authenticate(basic('alice', 'password1'), deps())).rejects.toMatchObject({
      status: 429,
      message: 'Too many login attempts; try again later',
    })
  })

  test('20 parallel bad Basic requests: at most 10 reach password verification, the rest get 429', async () => {
    await mk()
    let verified = 0
    const verify = async (plain: string, hash: string | undefined) => {
      verified++
      return verifyPasswordOrDummy(plain, hash)
    }
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => authenticate(basic('alice', 'wrong'), { ...deps(), verify })),
    )
    const statuses = results.map((r) => (r.status === 'rejected' ? (r.reason as { status: number }).status : 200))
    expect(verified).toBeLessThanOrEqual(10)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(10)
    expect(statuses.filter((s) => s === 401).length).toBe(verified)
  })

  test('a refused (429) attempt does not count; successes never accumulate', async () => {
    await mk()
    for (let i = 0; i < 10; i++) await authenticate(basic('alice', 'wrong'), deps()).catch(() => {})
    for (let i = 0; i < 5; i++) await authenticate(basic('alice', 'password1'), deps()).catch(() => {})
    expect(await h.probe.rateLimit('unknown')).toBe('10')
    await h.probe.reset()
    await mk()
    for (let i = 0; i < 15; i++) await authenticate(basic('alice', 'password1'), deps())
    expect(await h.probe.rateLimit('unknown')).toBe('0')
  })

  test('session-cookie requests do not count toward the rate limit', async () => {
    const u = await mk()
    const s = await users.createSession(u.id, 60)
    for (let i = 0; i < 12; i++) await authenticate(cookie(s.id), deps())
  })

  test('assertCsrf: cookie POST without/with wrong token → 403; with token ok; basic POST and GET need none', async () => {
    const u = await mk()
    const s = await users.createSession(u.id, 60)
    const principal = await authenticate(cookie(s.id), deps())
    expect(() => assertCsrf(cookie(s.id, 'POST'), principal)).toThrowError(expect.objectContaining({ status: 403 }))
    expect(() => assertCsrf(cookie(s.id, 'POST', { 'x-csrf-token': 'wrong' }), principal)).toThrowError(expect.objectContaining({ status: 403 }))
    expect(() => assertCsrf(cookie(s.id, 'POST', { 'x-csrf-token': s.csrfToken }), principal)).not.toThrow()
    expect(() => assertCsrf(cookie(s.id, 'GET'), principal)).not.toThrow()
    const viaBasic = await authenticate(basic('alice', 'password1', 'POST'), deps())
    expect(() => assertCsrf(basic('alice', 'password1', 'POST'), viaBasic)).not.toThrow()
  })
})
