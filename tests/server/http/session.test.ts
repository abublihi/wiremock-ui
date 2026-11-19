import { afterAll, beforeAll, expect, test } from 'vitest'
import { changePassword, getSession, login as loginHandler, logout } from '../../../src/server/http/handlers/session'
import { createMock, listMocks } from '../../../src/server/http/handlers/mocks'
import type { Runtime } from '../../../src/server/runtime'
import { basic, login, req, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
}, 120_000)

afterAll(async () => {
  await env?.stop()
})

test('login sets an HttpOnly cookie; GET /api/session returns user and csrfToken', async () => {
  const res = await loginHandler(rt, req('/api/session', 'POST', { username: 'ui-admin', password: 'ui-admin-pass' }))
  expect(res.status).toBe(200)
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).toMatch(/^wmui_session=/)
  expect(setCookie).toContain('HttpOnly')
  const body = await res.json()
  expect(body.user).toMatchObject({ username: 'ui-admin', role: 'admin' })
  expect(body.user.passwordHash).toBeUndefined()
  expect(typeof body.csrfToken).toBe('string')

  const me = await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: setCookie.split(';')[0] }))
  expect(me.status).toBe(200)
  expect(await me.json()).toEqual({ user: body.user, csrfToken: body.csrfToken })
})

test('wrong password 401 without WWW-Authenticate header', async () => {
  const res = await loginHandler(rt, req('/api/session', 'POST', { username: 'ui-admin', password: 'nope' }))
  expect(res.status).toBe(401)
  expect(res.headers.get('www-authenticate')).toBeNull()
  const none = await listMocks(rt, req('/api/mocks'))
  expect(none.status).toBe(401)
  expect(none.headers.get('www-authenticate')).toBeNull()
})

test('login requires a JSON content type', async () => {
  const res = await loginHandler(rt, req('/api/session', 'POST', 'username=a', { 'Content-Type': 'text/plain' }))
  expect(res.status).toBe(415)
})

test('logout invalidates the cookie (next GET /api/session is 401)', async () => {
  const s = await login(rt, 'ui-admin', 'ui-admin-pass')
  const out = await logout(rt, req('/api/session', 'DELETE', undefined, { Cookie: s.cookie, 'X-CSRF-Token': s.csrf }))
  expect(out.status).toBe(204)
  expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
  const after = await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: s.cookie }))
  expect(after.status).toBe(401)
})

test('basic auth with the bootstrap admin still works for scripts (no CSRF needed)', async () => {
  const headers = { Authorization: basic('ui-admin', 'ui-admin-pass') }
  const me = await getSession(rt, req('/api/session', 'GET', undefined, headers))
  expect(await me.json()).toMatchObject({ csrfToken: null, user: { username: 'ui-admin' } })
  const created = await createMock(
    rt,
    req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/s/basic' }, response: { status: 200 } }, headers),
  )
  expect(created.status).toBe(201)
})

test('password change keeps the current session and drops the others', async () => {
  await rt.users.create({ username: 'pw-user', role: 'viewer', password: 'password-1' }, 'ui-admin')
  const a = await login(rt, 'pw-user', 'password-1')
  const b = await login(rt, 'pw-user', 'password-1')
  const bad = await changePassword(rt, req('/api/session/password', 'POST', { current: 'wrong-pass', next: 'password-2' }, { Cookie: a.cookie, 'X-CSRF-Token': a.csrf }))
  expect(bad.status).toBe(400)
  const ok = await changePassword(rt, req('/api/session/password', 'POST', { current: 'password-1', next: 'password-2' }, { Cookie: a.cookie, 'X-CSRF-Token': a.csrf }))
  expect(ok.status).toBe(204)
  expect((await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: a.cookie }))).status).toBe(200)
  expect((await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: b.cookie }))).status).toBe(401)
  await login(rt, 'pw-user', 'password-2')
})

test('POST /api/session: 15 successful logins from one IP all succeed', async () => {
  for (let i = 0; i < 15; i++) {
    const res = await loginHandler(rt, req('/api/session', 'POST', { username: 'ui-admin', password: 'ui-admin-pass' }, { 'X-Forwarded-For': '203.0.113.20' }))
    expect(res.status, `login ${i + 1}`).toBe(200)
  }
})

test('POST /api/session is 429 after 10 failed attempts from one IP', async () => {
  const attempt = () =>
    loginHandler(rt, req('/api/session', 'POST', { username: 'ui-admin', password: 'wrong-pass' }, { 'X-Forwarded-For': '203.0.113.7' }))
  for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401)
  const blocked = await attempt()
  expect(blocked.status).toBe(429)
  // The right password is also refused while blocked; another IP is unaffected.
  const right = await loginHandler(rt, req('/api/session', 'POST', { username: 'ui-admin', password: 'ui-admin-pass' }, { 'X-Forwarded-For': '203.0.113.7' }))
  expect(right.status).toBe(429)
  await login(rt, 'ui-admin', 'ui-admin-pass')
})
