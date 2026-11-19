import { afterAll, beforeAll, expect, test } from 'vitest'
import { clearRequests, countRequests, getRequest, listRequests } from '../../../src/server/http/handlers/requests'
import type { Runtime } from '../../../src/server/runtime'
import { basic, login, req as baseReq, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
let tester: { cookie: string; csrf: string }
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = auth) => baseReq(path, method, body, headers)
const hit = (path: string, init?: RequestInit) => fetch(`${env.wm.url}${path}`, init)

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  await rt.users.create({ username: 'tess', role: 'tester', password: 'password-1' }, 'ui-admin')
  tester = await login(rt, 'tess', 'password-1')
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

test('list, detail and count over HTTP', async () => {
  await rt.requests.clear('ui-admin')
  await hit('/h/a')
  await hit('/h/a')
  const res = await listRequests(rt, req('/api/requests?matched=false&status=404&q=h/a&limit=10'))
  expect(res.status).toBe(200)
  const rows = await res.json()
  expect(rows).toHaveLength(2)
  const one = await getRequest(rt, req(`/api/requests/${rows[0].id}`), { id: rows[0].id })
  expect((await one.json()).request.url).toBe('/h/a')
  expect((await getRequest(rt, req('/api/requests/nope'), { id: 'nope' })).status).toBe(404)
  const count = await countRequests(rt, req('/api/requests/count', 'POST', { pattern: { method: 'GET', urlPath: '/h/a' } }))
  expect(await count.json()).toEqual({ count: 2 })
})

test('query validation returns 400', async () => {
  for (const q of ['limit=0', 'limit=1001', 'limit=x', 'since=yesterday', 'matched=maybe', 'status=99', 'status=600']) {
    expect((await listRequests(rt, req(`/api/requests?${q}`))).status, q).toBe(400)
  }
})

test('count body validation: pattern object, JSON content type', async () => {
  expect((await countRequests(rt, req('/api/requests/count', 'POST', {}))).status).toBe(400)
  expect((await countRequests(rt, req('/api/requests/count', 'POST', { pattern: [] }))).status).toBe(400)
  expect((await countRequests(rt, req('/api/requests/count', 'POST', { pattern: 'x' }))).status).toBe(400)
  const text = await countRequests(rt, req('/api/requests/count', 'POST', '{"pattern":{}}', { ...auth, 'Content-Type': 'text/plain' }))
  expect(text.status).toBe(415)
})

test('clear: tester 403 and log intact; admin clears', async () => {
  await hit('/h/b')
  const as = { Cookie: tester.cookie, 'X-CSRF-Token': tester.csrf }
  const denied = await clearRequests(rt, req('/api/requests', 'DELETE', undefined, as))
  expect(denied.status).toBe(403)
  expect((await rt.requests.list({})).length).toBeGreaterThan(0)
  // testers may still read
  expect((await listRequests(rt, req('/api/requests', 'GET', undefined, as))).status).toBe(200)
  expect((await clearRequests(rt, req('/api/requests', 'DELETE'))).status).toBe(200)
  expect(await rt.requests.list({})).toEqual([])
  expect((await listRequests(rt, req('/api/requests', 'GET', undefined, {}))).status).toBe(401)
})
