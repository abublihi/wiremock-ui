import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { runImport } from '../../../src/server/http/handlers/imports'
import type { Endpoint, Integration } from '../../../src/server/catalog/types'
import { fromStub } from '../../../src/ui/lib/editor-sync'
import { commonFirstSegment, defaultIntegration, parsePostman, planPostman } from '../../../src/ui/lib/postman'
import { login, req, startTestRuntime } from '../../helpers/http'

// A Postman collection mapped in the browser (src/ui/lib/postman.ts) imports through POST /api/import, and
// WireMock answers each saved example's request with that example — on every driver, WireMock-only mode included.

let env: Awaited<ReturnType<typeof startTestRuntime>>
let admin: { cookie: string; csrf: string }
const as = (s: { cookie: string; csrf: string }) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf })

const collection = parsePostman(JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/postman/shop-v2.1.json'), 'utf8')))
const plan = planPostman(collection, { integration: { ...defaultIntegration(collection), prefix: commonFirstSegment(collection)! } })

beforeAll(async () => {
  env = await startTestRuntime()
  admin = await login(env.rt, 'ui-admin', 'ui-admin-pass')
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

const importPlan = async () => {
  const res = await runImport(env.rt, req('/api/import', 'POST', plan.bundle, as(admin)))
  expect(res.status).toBe(200)
  return res.json()
}

test('imports one integration, its endpoints and a mock per usable example', async () => {
  const report = await importPlan()
  expect(report).toMatchObject({ integrations: 1, endpoints: 5, created: plan.mocks, pruned: 0, skipped: [] })
  expect(await env.rt.catalog.getIntegration('shop-api')).toMatchObject({ name: 'Shop API', prefix: '/api' })
  expect((await env.rt.catalog.listEndpoints('shop-api')).map((e) => e.key).sort()).toEqual(
    ['create-order', 'customer-graph', 'get-order', 'search-orders', 'sign-in'],
  )
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

test('the default mocks open in the Simple editor', async () => {
  const integration = (await env.rt.catalog.getIntegration('shop-api')) as Integration
  const endpoints = new Map((await env.rt.catalog.listEndpoints('shop-api')).map((e) => [e.key, e as Endpoint]))
  const stubs = (await env.rt.store.listAll()).filter((s) => s.metadata?.wiremockUi?.integration === 'shop-api')
  const defaults = stubs.filter((s) => s.priority === 10)
  expect(defaults).toHaveLength(4)
  for (const stub of defaults) {
    expect(fromStub(stub, integration, endpoints.get(stub.metadata!.wiremockUi!.endpoint!)!), stub.name).not.toBeNull()
  }
})

test('importing the same collection again changes nothing and deletes nothing', async () => {
  const before = (await env.rt.store.listAll()).length
  const report = await importPlan()
  expect(report).toMatchObject({ created: 0, updated: 0, unchanged: plan.mocks, pruned: 0 })
  expect((await env.rt.store.listAll()).length).toBe(before)
})

test('re-importing with "Create new" (the default) adds -2 endpoints with mocks of their own and leaves the originals alone', async () => {
  const snapshot = async () =>
    (await env.rt.store.listAll())
      .filter((s) => s.metadata?.wiremockUi?.integration === 'shop-api')
      .map((s) => ({ id: s.id, endpoint: s.metadata!.wiremockUi!.endpoint, name: s.name }))
      .sort((a, b) => a.id.localeCompare(b.id))
  const before = await snapshot()
  // What the Import page does when the integration exists: plan against the stored catalog with the default actions.
  const stored = (await env.rt.catalog.getIntegration('shop-api')) as Integration
  const existing = { integration: stored, endpointKeys: (await env.rt.catalog.listEndpoints('shop-api')).map((e) => e.key) }
  const again = planPostman(collection, { integration: stored, existing })
  expect(again.rows.map((r) => r.key)).toEqual(['get-order-2', 'search-orders-2', 'create-order-2', 'sign-in-2', 'customer-graph-2'])
  const res = await runImport(env.rt, req('/api/import', 'POST', again.bundle, as(admin)))
  expect(await res.json()).toMatchObject({ created: plan.mocks, updated: 0, pruned: 0 })

  const after = await snapshot()
  // The original endpoints keep exactly the mocks they had.
  expect(after.filter((m) => !m.endpoint!.endsWith('-2'))).toEqual(before)
  const copies = after.filter((m) => m.endpoint!.endsWith('-2'))
  expect(copies).toHaveLength(plan.mocks)
  expect(new Set(copies.map((m) => m.endpoint))).toEqual(new Set(['get-order-2', 'search-orders-2', 'create-order-2', 'sign-in-2']))

  // Overwrite on every row: same keys, same ids — nothing new, nothing duplicated.
  const endpointKeys = (await env.rt.catalog.listEndpoints('shop-api')).map((e) => e.key)
  const overwrite = planPostman(collection, {
    integration: stored,
    existing: { integration: stored, endpointKeys },
    choices: Object.fromEntries(again.rows.map((r) => [r.id, { action: 'overwrite' as const }])),
  })
  const res2 = await runImport(env.rt, req('/api/import', 'POST', overwrite.bundle, as(admin)))
  expect(await res2.json()).toMatchObject({ created: 0, updated: 0, unchanged: plan.mocks, pruned: 0 })
  expect(await snapshot()).toEqual(after)
  expect((await env.rt.catalog.listEndpoints('shop-api')).length).toBe(10)
})
