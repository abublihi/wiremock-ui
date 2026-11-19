import { afterAll, beforeAll, expect, test } from 'vitest'
import { getSession } from '../../../src/server/http/handlers/session'
import { createUser, deleteUser, listUsers, updateUser } from '../../../src/server/http/handlers/users'
import type { Runtime } from '../../../src/server/runtime'
import { login, req, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
let admin: { cookie: string; csrf: string }

const as = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf })

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  admin = await login(rt, 'ui-admin', 'ui-admin-pass')
}, 120_000)

afterAll(async () => {
  await env?.stop()
})

test('any signed-in user manages users; responses never carry role or passwordHash', async () => {
  const created = await createUser(rt, req('/api/users', 'POST', { username: 'Tess', password: 'password-1' }, as(admin)))
  expect(created.status).toBe(201)
  const user = await created.json()
  expect(user).toMatchObject({ username: 'tess', disabled: false })
  expect(user.passwordHash).toBeUndefined()
  expect(user.role).toBeUndefined()

  const list = await listUsers(rt, req('/api/users', 'GET', undefined, as(admin)))
  const listed = await list.json()
  expect(listed.map((u: { username: string }) => u.username)).toEqual(['tess', 'ui-admin'])
  expect(listed.some((u: Record<string, unknown>) => 'role' in u || 'passwordHash' in u)).toBe(false)

  const second = await login(rt, 'tess', 'password-1')
  expect((await listUsers(rt, req('/api/users', 'GET', undefined, as(second)))).status).toBe(200)
  expect((await createUser(rt, req('/api/users', 'POST', { username: 'x1', password: 'password-1' }, as(second)))).status).toBe(201)

  const patched = await updateUser(rt, req(`/api/users/${user.id}`, 'PATCH', { displayName: 'Tess T' }, as(second)), { id: user.id })
  const body = await patched.json()
  expect(body).toMatchObject({ displayName: 'Tess T' })
  expect(body.role).toBeUndefined()

  const del = await deleteUser(rt, req(`/api/users/${user.id}`, 'DELETE', undefined, as(admin)), { id: user.id })
  expect(del.status).toBe(204)
  expect((await deleteUser(rt, req(`/api/users/${user.id}`, 'DELETE', undefined, as(admin)), { id: user.id })).status).toBe(404)
})

test('role is not part of the API: POST and PATCH reject it with 400', async () => {
  const post = await createUser(rt, req('/api/users', 'POST', { username: 'rolly', role: 'tester', password: 'password-1' }, as(admin)))
  expect(post.status).toBe(400)
  expect(await post.json()).toEqual({ error: 'unknown field: role' })
  const u = await (await createUser(rt, req('/api/users', 'POST', { username: 'rolly', password: 'password-1' }, as(admin)))).json()
  const patch = await updateUser(rt, req(`/api/users/${u.id}`, 'PATCH', { role: 'viewer' }, as(admin)), { id: u.id })
  expect(patch.status).toBe(400)
  expect(await patch.json()).toEqual({ error: 'unknown field: role' })
})

test('the last active user cannot be disabled or deleted (409)', async () => {
  for (const u of await rt.users.list()) if (u.username !== 'ui-admin') await rt.users.remove(u.id, 'ui-admin')
  const me = (await (await listUsers(rt, req('/api/users', 'GET', undefined, as(admin)))).json()).find(
    (u: { username: string }) => u.username === 'ui-admin',
  )
  const res = await updateUser(rt, req(`/api/users/${me.id}`, 'PATCH', { disabled: true }, as(admin)), { id: me.id })
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'At least one active user is required' })
  const del = await deleteUser(rt, req(`/api/users/${me.id}`, 'DELETE', undefined, as(admin)), { id: me.id })
  expect(del.status).toBe(409)
})

test('invalid bodies are 400', async () => {
  const bad = await createUser(rt, req('/api/users', 'POST', { username: 'Z', password: 'password-1' }, as(admin)))
  expect(bad.status).toBe(400)
  const noPw = await createUser(rt, req('/api/users', 'POST', { username: 'zed' }, as(admin)))
  expect(noPw.status).toBe(400)
})

test('PATCH rejects unknown fields and empty patches', async () => {
  const u = await (await createUser(rt, req('/api/users', 'POST', { username: 'patchy', password: 'password-1' }, as(admin)))).json()
  const unknown = await updateUser(rt, req(`/api/users/${u.id}`, 'PATCH', { username: 'other' }, as(admin)), { id: u.id })
  expect(unknown.status).toBe(400)
  expect((await unknown.json()).error).toContain('username')
  const empty = await updateUser(rt, req(`/api/users/${u.id}`, 'PATCH', {}, as(admin)), { id: u.id })
  expect(empty.status).toBe(400)
  expect(await empty.json()).toEqual({ error: 'patch must change at least one field' })
})

test("admin resetting their own password keeps the current session and drops the others; another user's reset drops all", async () => {
  await rt.users.create({ username: 'admin-two', password: 'password-1' }, 'ui-admin')
  const a = await login(rt, 'admin-two', 'password-1')
  const b = await login(rt, 'admin-two', 'password-1')
  const me = (await (await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: a.cookie }))).json()).user
  const res = await updateUser(rt, req(`/api/users/${me.id}`, 'PATCH', { password: 'password-2' }, as(a)), { id: me.id })
  expect(res.status).toBe(200)
  expect((await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: a.cookie }))).status).toBe(200)
  expect((await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: b.cookie }))).status).toBe(401)

  const c = await login(rt, 'admin-two', 'password-2')
  await updateUser(rt, req(`/api/users/${me.id}`, 'PATCH', { password: 'password-3' }, as(admin)), { id: me.id })
  expect((await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: a.cookie }))).status).toBe(401)
  expect((await getSession(rt, req('/api/session', 'GET', undefined, { Cookie: c.cookie }))).status).toBe(401)
})
