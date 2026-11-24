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

test('an ordinary user can read the audit log; no credentials 401', async () => {
  await rt.users.create({ username: 'audit-plain', password: 'password-1' }, 'ui-admin')
  const s = await login(rt, 'audit-plain', 'password-1')
  expect((await listAudit(rt, req('/api/audit', { Cookie: s.cookie }))).status).toBe(200)
  expect((await listAudit(rt, req('/api/audit', {}))).status).toBe(401)
})

test('filters by actor, action group and day, and still pages', async () => {
  for (let i = 0; i < 4; i++) await rt.audit.record({ actor: 'filter-a', action: 'scenario.set-state', target: `s${i}`, details: { state: 'x' } })
  await rt.audit.record({ actor: 'filter-b', action: 'scenario.reset-all', target: '*' })
  await rt.audit.record({ actor: 'filter-a', action: 'requests.clear' })
  const page = async (q: string) => (await listAudit(rt, req(`/api/audit?${q}`))).json()
  const byActor = await page('actor=filter-a&action=scenario&limit=3')
  expect(byActor.entries.map((e: { target: string }) => e.target)).toEqual(['s3', 's2', 's1'])
  const rest = await page(`actor=filter-a&action=scenario&limit=3&cursor=${encodeURIComponent(byActor.nextCursor)}`)
  expect(rest.entries.map((e: { target: string }) => e.target)).toEqual(['s0'])
  expect((await page('actor=filter-b')).entries.map((e: { action: string }) => e.action)).toEqual(['scenario.reset-all'])
  const today = new Date().toISOString().slice(0, 10)
  expect((await page(`actor=filter-a&from=${today}&to=${today}`)).entries).toHaveLength(5)
  expect((await page(`actor=filter-a&to=2000-01-01`)).entries).toEqual([])
  for (const q of ['from=yesterday', 'to=2026-13-01', 'action=', 'actor=']) expect((await listAudit(rt, req(`/api/audit?${q}`))).status, q).toBe(400)
})

test('names what each entry is about: a mock by name, or that it is gone; an old integration entry keeps its kind', async () => {
  await rt.audit.record({ actor: 'ui-admin', action: 'catalog.integration.upsert', target: 'aud' })
  const admin = (await rt.users.list()).find((u) => u.username === 'ui-admin')!
  const mock = await rt.mocks.create({ name: 'Audit ping', request: { method: 'GET', urlPath: '/aud/ping' }, response: { status: 200 } }, admin)
  const gone = await rt.mocks.create({ name: 'Short-lived', request: { method: 'GET', urlPath: '/aud/gone' }, response: { status: 200 } }, admin)
  await rt.mocks.delete(gone.id, undefined, admin)
  const { entries } = await (await listAudit(rt, req('/api/audit?limit=10'))).json()
  const about = (action: string, target: string) => entries.find((e: { action: string; target?: string }) => e.action === action && e.target === target)?.subject
  expect(about('mock.create', mock.id)).toEqual({ kind: 'mock', name: 'Audit ping' })
  expect(about('mock.delete', gone.id)).toEqual({ kind: 'mock', name: null })
  expect(about('catalog.integration.upsert', 'aud')).toEqual({ kind: 'integration', name: null })
})
