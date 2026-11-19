import { afterAll, beforeAll, expect, test } from 'vitest'
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

test('admin manages users; tester GET /api/users is 403', async () => {
  const created = await createUser(rt, req('/api/users', 'POST', { username: 'Tess', role: 'tester', password: 'password-1' }, as(admin)))
  expect(created.status).toBe(201)
  const user = await created.json()
  expect(user).toMatchObject({ username: 'tess', role: 'tester', disabled: false })
  expect(user.passwordHash).toBeUndefined()

  const list = await listUsers(rt, req('/api/users', 'GET', undefined, as(admin)))
  expect((await list.json()).map((u: { username: string }) => u.username)).toEqual(['tess', 'ui-admin'])

  const tester = await login(rt, 'tess', 'password-1')
  expect((await listUsers(rt, req('/api/users', 'GET', undefined, as(tester)))).status).toBe(403)
  expect((await createUser(rt, req('/api/users', 'POST', { username: 'x1', role: 'viewer', password: 'password-1' }, as(tester)))).status).toBe(403)

  const patched = await updateUser(rt, req(`/api/users/${user.id}`, 'PATCH', { role: 'developer', displayName: 'Tess T' }, as(admin)), { id: user.id })
  expect(await patched.json()).toMatchObject({ role: 'developer', displayName: 'Tess T' })

  const del = await deleteUser(rt, req(`/api/users/${user.id}`, 'DELETE', undefined, as(admin)), { id: user.id })
  expect(del.status).toBe(204)
  expect((await deleteUser(rt, req(`/api/users/${user.id}`, 'DELETE', undefined, as(admin)), { id: user.id })).status).toBe(404)
})

test('last admin: PATCH role→tester on the only admin → 409', async () => {
  const me = (await (await listUsers(rt, req('/api/users', 'GET', undefined, as(admin)))).json()).find(
    (u: { username: string }) => u.username === 'ui-admin',
  )
  const res = await updateUser(rt, req(`/api/users/${me.id}`, 'PATCH', { role: 'tester' }, as(admin)), { id: me.id })
  expect(res.status).toBe(409)
  const del = await deleteUser(rt, req(`/api/users/${me.id}`, 'DELETE', undefined, as(admin)), { id: me.id })
  expect(del.status).toBe(409)
})

test('invalid bodies are 400', async () => {
  const bad = await createUser(rt, req('/api/users', 'POST', { username: 'zed', role: 'root', password: 'password-1' }, as(admin)))
  expect(bad.status).toBe(400)
  const noPw = await createUser(rt, req('/api/users', 'POST', { username: 'zed', role: 'viewer' }, as(admin)))
  expect(noPw.status).toBe(400)
})

test('PATCH rejects unknown fields and empty patches', async () => {
  const u = await (await createUser(rt, req('/api/users', 'POST', { username: 'patchy', role: 'viewer', password: 'password-1' }, as(admin)))).json()
  const unknown = await updateUser(rt, req(`/api/users/${u.id}`, 'PATCH', { username: 'other' }, as(admin)), { id: u.id })
  expect(unknown.status).toBe(400)
  expect((await unknown.json()).error).toContain('username')
  const empty = await updateUser(rt, req(`/api/users/${u.id}`, 'PATCH', {}, as(admin)), { id: u.id })
  expect(empty.status).toBe(400)
  expect(await empty.json()).toEqual({ error: 'patch must change at least one field' })
})
