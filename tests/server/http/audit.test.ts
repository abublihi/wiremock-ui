import { afterAll, beforeAll, expect, test } from 'vitest'
import { listAudit } from '../../../src/server/http/handlers/audit'
import type { Runtime } from '../../../src/server/runtime'
import { basic, login, req as baseReq, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const req = (path: string, headers: Record<string, string> = auth) => baseReq(path, 'GET', undefined, headers)

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

test('admin pages the audit log newest first with an opaque cursor', async () => {
  for (let i = 0; i < 5; i++) await rt.audit.record({ actor: 'ui-admin', action: `t.${i}` })
  const first = await listAudit(rt, req('/api/audit?limit=3'))
  expect(first.status).toBe(200)
  const page1 = await first.json()
  expect(page1.entries.map((e: { action: string }) => e.action)).toEqual(['t.4', 't.3', 't.2'])
  expect(typeof page1.nextCursor).toBe('string')
  const second = await (await listAudit(rt, req(`/api/audit?limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`))).json()
  expect(second.entries.map((e: { action: string }) => e.action).slice(0, 2)).toEqual(['t.1', 't.0'])
  const all = await (await listAudit(rt, req('/api/audit'))).json()
  expect(all.entries.length).toBeGreaterThanOrEqual(5)
})

test('limit must be an integer 1–500; a bad cursor is 400', async () => {
  for (const q of ['limit=0', 'limit=501', 'limit=x', 'limit=1.5', 'limit=', 'cursor=garbage']) {
    const res = await listAudit(rt, req(`/api/audit?${q}`))
    expect(res.status, q).toBe(400)
    expect(await res.json()).toHaveProperty('error')
  }
  expect((await listAudit(rt, req('/api/audit?limit=500'))).status).toBe(200)
})

test('non-admins get 403; no credentials 401', async () => {
  for (const role of ['viewer', 'tester', 'developer'] as const) {
    await rt.users.create({ username: `audit-${role}`, role, password: 'password-1' }, 'ui-admin')
    const s = await login(rt, `audit-${role}`, 'password-1')
    const res = await listAudit(rt, req('/api/audit', { Cookie: s.cookie }))
    expect(res.status, role).toBe(403)
  }
  expect((await listAudit(rt, req('/api/audit', {}))).status).toBe(401)
})
