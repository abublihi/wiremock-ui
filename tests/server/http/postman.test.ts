import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { runImport } from '../../../src/server/http/handlers/imports'
import { tagsOf } from '../../../src/server/mocks/tags'
import { parsePostman, postmanBundle } from '../../../src/ui/lib/postman'
import { login, req, startTestRuntime } from '../../helpers/http'

// A Postman collection turned into mocks in the browser (src/ui/lib/postman.ts: postmanBundle) imports through
// POST /api/import, and WireMock answers each saved example's request with that example — on every driver.

let env: Awaited<ReturnType<typeof startTestRuntime>>
let admin: { cookie: string; csrf: string }
const as = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf })

const collection = parsePostman(JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/postman/shop-v2.1.json'), 'utf8')))
const converted = postmanBundle(collection)

beforeAll(async () => {
  env = await startTestRuntime()
  admin = await login(env.rt, 'ui-admin', 'ui-admin-pass')
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

const importIt = async () => {
  const res = await runImport(env.rt, req('/api/import', 'POST', converted.bundle, as(admin)))
  expect(res.status).toBe(200)
  return res.json()
}

test('imports a mock per usable example, tagged with the collection; no integrations', async () => {
  const report = await importIt()
  expect(report).toMatchObject({ created: converted.bundle.mocks.length, pruned: 0, skipped: [] })
  expect(report).not.toHaveProperty('integrations')
  const stored = (await env.rt.store.listAll()).filter((s) => tagsOf(s).includes('shop-api'))
  expect(stored).toHaveLength(converted.bundle.mocks.length)
  for (const s of stored) {
    expect(s.metadata?.wiremockUi?.integration).toBeUndefined()
    expect(s.metadata?.wiremockUi?.endpoint).toBeUndefined()
  }
})

const call = async (method: string, path: string, init: { json?: unknown; form?: string } = {}) => {
  const res = await fetch(`${env.wm.url}${path}`, {
    method,
    headers: init.json !== undefined ? { 'Content-Type': 'application/json' } : init.form !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

test('WireMock answers each example request with its example', async () => {
  expect(await call('GET', '/api/orders/1')).toEqual({ status: 200, body: { id: 1, status: 'pending' } })
  expect(await call('GET', '/api/orders/999')).toEqual({ status: 404, body: { error: 'order not found' } })
  expect(await call('GET', '/api/orders?status=pending')).toEqual({ status: 200, body: [{ id: 1 }] })
  expect(await call('GET', '/api/orders?status=shipped')).toEqual({ status: 200, body: [{ id: 2 }] })
  expect(await call('POST', '/api/orders', { json: { sku: 'A-1', qty: 1 } })).toEqual({ status: 201, body: { id: 10, status: 'pending' } })
  // equalToJson with ignoreExtraElements: extra fields still match.
  expect(await call('POST', '/api/orders', { json: { sku: 'Z-9', qty: 1, note: 'x' } })).toEqual({ status: 409, body: { error: 'out of stock' } })
  expect(await call('POST', '/api/login', { form: 'user=sara&password=secret' })).toEqual({ status: 200, body: { token: 'abc' } })
  expect(await call('POST', '/api/login', { form: 'user=sara&password=wrong' })).toEqual({ status: 401, body: { error: 'bad credentials' } })
})

test('importing the same collection again changes nothing and deletes nothing', async () => {
  const before = (await env.rt.store.listAll()).length
  const report = await importIt()
  expect(report).toMatchObject({ created: 0, updated: 0, unchanged: converted.bundle.mocks.length, pruned: 0 })
  expect((await env.rt.store.listAll()).length).toBe(before)
})
