import { afterAll, beforeAll, expect, test } from 'vitest'
import { clearRequests, countRequests, getRequest, listRequests } from '../../../src/server/http/handlers/requests'
import { UNMATCHED_CACHE_MS } from '../../../src/server/requests/journal'
import type { Runtime } from '../../../src/server/runtime'
import { STORELESS, basic, login, req as baseReq, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
let tester: { cookie: string; csrf: string }
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = auth) => baseReq(path, method, body, headers)
const hit = (path: string, init?: RequestInit) => fetch(`${env.wm.url}${path}`, init)

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  // WireMock-only mode has the one ADMIN_USER account.
  if (!STORELESS) await rt.users.create({ username: 'tess', password: 'password-1' }, 'ui-admin')
  tester = STORELESS ? await login(rt, 'ui-admin', 'ui-admin-pass') : await login(rt, 'tess', 'password-1')
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

test('clear: an ordinary user clears the log', async () => {
  await hit('/h/b')
  const as = { Cookie: tester.cookie, 'X-CSRF-Token': tester.csrf }
  expect((await rt.requests.list({})).length).toBeGreaterThan(0)
  expect((await listRequests(rt, req('/api/requests', 'GET', undefined, as))).status).toBe(200)
  const cleared = await clearRequests(rt, req('/api/requests', 'DELETE', undefined, as))
  expect(cleared.status).toBe(204)
  expect(await cleared.text()).toBe('')
  expect(await rt.requests.list({})).toEqual([])
  expect((await listRequests(rt, req('/api/requests', 'GET', undefined, {}))).status).toBe(401)
})

test('recent unmatched count: only unmatched requests in the window, counted over the whole journal and capped', async () => {
  const { recentUnmatchedCount } = await import('../../../src/server/http/handlers/requests')
  await rt.requests.clear('ui-admin')
  // Many matched requests after the unmatched ones: a list with a small limit would never reach these.
  await rt.wiremock.importStubs([{ id: '7d1d5a0e-1b8a-4a52-9a37-5d3c3c1f0a01', request: { method: 'GET', urlPath: '/um/ok' }, response: { status: 200 } }], { deleteAllNotInImport: false })
  for (let i = 0; i < 3; i++) await hit(`/um/miss/${i}`)
  for (let i = 0; i < 30; i++) await hit('/um/ok')
  const res = await recentUnmatchedCount(rt, req('/api/requests/unmatched-count?minutes=15'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ count: 3, capped: false })

  for (let i = 0; i < 100; i++) await hit(`/um/more/${i}`)
  // The count is read from WireMock at most every few seconds (shared by every poller).
  await new Promise((r) => setTimeout(r, UNMATCHED_CACHE_MS + 100))
  expect(await (await recentUnmatchedCount(rt, req('/api/requests/unmatched-count?minutes=15'))).json()).toEqual({ count: 100, capped: true })
  expect(await (await recentUnmatchedCount(rt, req('/api/requests/unmatched-count?minutes=0'))).status).toBe(400)
})

test('Load older: pages below a cursor with the filters applied first; nextCursor until nothing older matches', async () => {
  await rt.requests.clear('ui-admin')
  // 12 requests, oldest first: even ones go to /lo/even (unmatched 404), odd ones to /lo/odd.
  for (let i = 0; i < 12; i++) await hit(`/lo/${i % 2 === 0 ? 'even' : 'odd'}/${i}`)
  const page = async (query: string) => {
    const res = await listRequests(rt, req(`/api/requests?${query}`))
    expect(res.status, query).toBe(200)
    return (await res.json()) as { requests: { id: string; url: string; loggedAt: string }[]; nextCursor: string | null }
  }
  // The live page (filters applied to the newest rows) shows three of them; Load older continues below the third.
  const first = ((await (await listRequests(rt, req('/api/requests?q=/lo/even'))).json()) as { id: string; url: string; loggedAt: string }[]).slice(0, 3)
  expect(first.map((r) => r.url)).toEqual(['/lo/even/10', '/lo/even/8', '/lo/even/6'])
  const last = first[first.length - 1]
  const second = await page(`limit=3&q=/lo/even&before=${encodeURIComponent(`${last.loggedAt}|${last.id}`)}`)
  expect(second.requests.map((r) => r.url)).toEqual(['/lo/even/4', '/lo/even/2', '/lo/even/0'])
  // Nothing older is in the log: no cursor, so no "Load older".
  expect(second.nextCursor).toBeNull()
  const two = await page(`limit=2&q=/lo/even&before=${encodeURIComponent(`${last.loggedAt}|${last.id}`)}`)
  expect(two.requests.map((r) => r.url)).toEqual(['/lo/even/4', '/lo/even/2'])
  const rest = await page(`limit=2&q=/lo/even&before=${encodeURIComponent(two.nextCursor!)}`)
  expect(rest).toEqual({ requests: [expect.objectContaining({ url: '/lo/even/0' })], nextCursor: null })

  // Without a filter the page fills from the whole log, and the last page says there is nothing more.
  const all = await page(`limit=20&before=${encodeURIComponent(`${last.loggedAt}|${last.id}`)}`)
  expect(all.requests.map((r) => r.url)).toEqual(['/lo/odd/5', '/lo/even/4', '/lo/odd/3', '/lo/even/2', '/lo/odd/1', '/lo/even/0'])
  expect(all.nextCursor).toBeNull()

  const bad = await listRequests(rt, req('/api/requests?before=nope'))
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'before must be a request cursor: <loggedAt>|<id> of the last row shown', field: 'before' })
})
