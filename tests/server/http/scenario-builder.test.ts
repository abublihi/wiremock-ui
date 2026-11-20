import { afterAll, beforeAll, expect, test } from 'vitest'
import { createCatalogMock } from '../../../src/server/http/handlers/catalog'
import { createMock, deleteMock, listMocks, updateMock } from '../../../src/server/http/handlers/mocks'
import type { StubMapping } from '../../../src/server/wiremock/types'
import type { Endpoint, Integration } from '../../../src/server/catalog/types'
import {
  type BuilderDraft,
  editChanges,
  lastStepMocks,
  loadScenario,
  movedOn,
  newStep,
  nextStateName,
  removeStep,
  toCreates,
} from '../../../src/ui/lib/scenario-builder'
import { login, req, startTestRuntime } from '../../helpers/http'

// The scenario builder's output, sent through the same create endpoints the page uses: WireMock answers as the steps say.

let env: Awaited<ReturnType<typeof startTestRuntime>>
let admin: { cookie: string; csrf: string }
const as = () => ({ Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf })

let integration: Integration
let endpoint: Endpoint

beforeAll(async () => {
  env = await startTestRuntime()
  admin = await login(env.rt, 'ui-admin', 'ui-admin-pass')
  integration = await env.rt.catalog.upsertIntegration({ key: 'shop', name: 'Shop', prefix: '/shop' }, 'ui-admin')
  endpoint = await env.rt.catalog.upsertEndpoint(
    {
      integration: 'shop',
      key: 'order-status',
      name: 'Order status',
      method: 'GET',
      path: '/orders/status',
      pathType: 'exact',
      lookup: { location: 'query', expression: 'id' },
      contentType: 'json',
      exampleResponses: {},
      allowedStatuses: [],
    },
    'ui-admin',
  )
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

/** Creates every step like the page does; returns the HTTP statuses. */
async function save(draft: BuilderDraft): Promise<number[]> {
  const statuses: number[] = []
  for (const create of toCreates(draft)) {
    const res =
      create.kind === 'catalog'
        ? await createCatalogMock(
            env.rt,
            req(`/api/integrations/${create.args.integration}/endpoints/${create.args.endpoint}/mocks`, 'POST', create.args.input, as()),
            { key: create.args.integration, endpoint: create.args.endpoint },
          )
        : await createMock(env.rt, req('/api/mocks', 'POST', create.stub, as()))
    statuses.push(res.status)
  }
  return statuses
}

const call = async (path: string) => {
  const res = await fetch(`${env.wm.url}${path}`)
  return { status: res.status, body: await res.text() }
}

test('a catalog request: call 1 gets step 1, call 2 step 2, and the last step stays', async () => {
  const draft: BuilderDraft = {
    name: 'order-status',
    request: { kind: 'catalog', integration, endpoint, isDefault: false, keyValue: '42' },
    steps: [
      newStep('a', { body: '{"status":"pending"}' }),
      newStep('b', { state: 'approved', body: '{"status":"approved"}' }),
    ],
  }
  expect(await save(draft)).toEqual([201, 201])
  const first = await call('/shop/orders/status?id=42')
  expect(first.status).toBe(200)
  expect(JSON.parse(first.body)).toEqual({ status: 'pending' })
  expect(JSON.parse((await call('/shop/orders/status?id=42')).body)).toEqual({ status: 'approved' })
  expect(JSON.parse((await call('/shop/orders/status?id=42')).body)).toEqual({ status: 'approved' })

  const listed = (await env.rt.scenarios.list()).find((s) => s.name === 'order-status')!
  expect(listed.possibleStates).toEqual(['Started', 'approved'])
  expect(listed.state).toBe('approved')
})

test('method and URL: statuses, headers and a move back to step 1 behave as the steps describe', async () => {
  const draft: BuilderDraft = {
    name: 'parcel',
    request: { kind: 'free', method: 'GET', url: '/parcel/9' },
    steps: [
      newStep('a', { status: '202', body: '{"at":"warehouse"}' }),
      newStep('b', { state: 'shipped', body: 'on its way', headers: [{ name: 'Content-Type', value: 'text/plain' }] }),
      newStep('c', { state: 'lost', status: '404', body: 'lost', moveTo: 'step:a' }),
    ],
  }
  expect(await save(draft)).toEqual([201, 201, 201])
  const answers = []
  for (let i = 0; i < 4; i++) answers.push(await call('/parcel/9'))
  expect(answers).toEqual([
    { status: 202, body: '{"at":"warehouse"}' },
    { status: 200, body: 'on its way' },
    { status: 404, body: 'lost' },
    { status: 202, body: '{"at":"warehouse"}' },
  ])
})

test('a step added after the last one: the old last step answers first, then moves the scenario on to the new step', async () => {
  const request = { kind: 'catalog' as const, integration, endpoint, isDefault: false, keyValue: '77' }
  const draft: BuilderDraft = {
    name: 'refund',
    request,
    steps: [newStep('a', { body: '{"status":"pending"}' }), newStep('b', { state: 'approved', body: '{"status":"approved"}' })],
  }
  expect(await save(draft)).toEqual([201, 201])

  // "Add a mock to this scenario": a new state after the last one (approved), saved through the catalog create path.
  const listed = (await env.rt.scenarios.list()).find((s) => s.name === 'refund')!
  const after = listed.possibleStates.at(-1)!
  const next = nextStateName(listed.possibleStates)
  expect([after, next]).toEqual(['approved', 'step-3'])
  const res = await createCatalogMock(
    env.rt,
    req('/api/integrations/shop/endpoints/order-status/mocks', 'POST', { keyValue: '77', status: 200, body: '{"status":"paid out"}', scenario: { name: 'refund', requiredState: next } }, as()),
    { key: 'shop', endpoint: 'order-status' },
  )
  expect(res.status).toBe(201)
  const added = (await res.json()) as StubMapping

  // Then the old last step is made to move on (the editor's update path, with its version).
  const all = (await (await listMocks(env.rt, req('/api/mocks', 'GET', undefined, as()))).json()) as StubMapping[]
  const last = lastStepMocks(all, 'refund', after, added)
  expect(last.map((m) => m.name)).toEqual(['refund — approved'])
  for (const old of last) {
    const body = { stub: movedOn(old, next), version: old.metadata!.wiremockUi!.version }
    const updated = await updateMock(env.rt, req(`/api/mocks/${old.id}`, 'PUT', body, as()), { id: old.id })
    expect(updated.status).toBe(200)
  }

  const answers = []
  for (let i = 0; i < 4; i++) answers.push(JSON.parse((await call('/shop/orders/status?id=77')).body))
  expect(answers).toEqual([{ status: 'pending' }, { status: 'approved' }, { status: 'paid out' }, { status: 'paid out' }])
})

/** Loads a scenario like the edit page (GET /api/mocks?scenario=), applies `edit`, saves the difference like the page. */
async function editScenario(name: string, edit: (draft: BuilderDraft) => BuilderDraft): Promise<number[]> {
  const res = await listMocks(env.rt, req(`/api/mocks?scenario=${encodeURIComponent(name)}`, 'GET', undefined, as()))
  const loaded = loadScenario((await res.json()) as StubMapping[], name)
  const draft = edit({ name, request: { kind: 'existing' }, steps: loaded.steps })
  const statuses: number[] = []
  for (const change of editChanges(loaded, draft)) {
    const version = (stub: StubMapping) => stub.metadata!.wiremockUi!.version
    const out =
      change.kind === 'create'
        ? await createMock(env.rt, req('/api/mocks', 'POST', change.stub, as()))
        : change.kind === 'update'
          ? await updateMock(env.rt, req(`/api/mocks/${change.before.id}`, 'PUT', { stub: change.stub, version: version(change.before) }, as()), { id: change.before.id })
          : await deleteMock(env.rt, req(`/api/mocks/${change.before.id}?version=${version(change.before)}`, 'DELETE', undefined, as()), { id: change.before.id })
    statuses.push(out.status)
  }
  await env.rt.wiremock.resetScenarios()
  return statuses
}

test('editing a scenario as one unit: WireMock answers as edited (changed body, added step, rename, removed step)', async () => {
  const draft: BuilderDraft = {
    name: 'shipment',
    request: { kind: 'catalog', integration, endpoint, isDefault: false, keyValue: '55' },
    steps: [newStep('a', { body: '{"status":"packed"}' }), newStep('b', { state: 'transit', body: '{"status":"moving"}' })],
  }
  expect(await save(draft)).toEqual([201, 201])
  const answers = async (n: number) => {
    const out = []
    for (let i = 0; i < n; i++) out.push(JSON.parse((await call('/shop/orders/status?id=55')).body))
    return out
  }
  expect(await answers(2)).toEqual([{ status: 'packed' }, { status: 'moving' }])

  // Step 2 answers differently, a step 3 is added after it, and the scenario is renamed: 1 create + 2 updates.
  const edited = await editScenario('shipment', (d) => ({
    ...d,
    name: 'shipment-v2',
    steps: [
      ...d.steps.map((s) => (s.state === 'transit' ? { ...s, body: '{"status":"in transit"}' } : s)),
      newStep('c', { state: 'delivered', body: '{"status":"delivered"}' }),
    ],
  }))
  expect(edited).toEqual([201, 200, 200])
  expect(await answers(4)).toEqual([{ status: 'packed' }, { status: 'in transit' }, { status: 'delivered' }, { status: 'delivered' }])
  const scenarios = await env.rt.scenarios.list()
  expect(scenarios.find((s) => s.name === 'shipment')).toBeUndefined()
  expect(scenarios.find((s) => s.name === 'shipment-v2')!.possibleStates).toEqual(['Started', 'transit', 'delivered'])
  // The new step kept the catalog link of the step before it.
  const mocks = (await (await listMocks(env.rt, req('/api/mocks?scenario=shipment-v2', 'GET', undefined, as()))).json()) as StubMapping[]
  expect(mocks.map((m) => m.metadata?.wiremockUi?.endpoint)).toEqual(['order-status', 'order-status', 'order-status'])

  // Step 2 removed: step 1 now moves straight to delivered (1 update + 1 delete).
  const transit = (await editScenario('shipment-v2', (d) => ({ ...d, steps: removeStep(d.steps, d.steps[1].id) })))
  expect(transit).toEqual([200, 204])
  expect(await answers(3)).toEqual([{ status: 'packed' }, { status: 'delivered' }, { status: 'delivered' }])
})
