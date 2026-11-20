import { afterAll, beforeAll, expect, test } from 'vitest'
import { createCatalogMock } from '../../../src/server/http/handlers/catalog'
import { createMock } from '../../../src/server/http/handlers/mocks'
import type { Endpoint, Integration } from '../../../src/server/catalog/types'
import { type BuilderDraft, newStep, toCreates } from '../../../src/ui/lib/scenario-builder'
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
