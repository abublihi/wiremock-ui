import { afterAll, beforeAll, expect, test } from 'vitest'
import { buildStub, type SimpleMockInput } from '../../../src/server/catalog/build'
import type { Endpoint, Integration } from '../../../src/server/catalog/types'
import { startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>

beforeAll(async () => {
  env = await startTestRuntime()
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
const endpoint = (extra: Partial<Endpoint>): Endpoint => ({
  integration: 'nic', key: 'e', name: 'E', method: 'POST', path: '/x', pathType: 'exact', contentType: 'json',
  exampleResponses: {}, allowedStatuses: [], updatedAt: '', updatedBy: '', ...extra,
})
const actor = { id: 'a', username: 'ui-admin', displayName: 'a', disabled: false, createdAt: '', updatedAt: '' } as const

async function install(e: Endpoint, key: SimpleMockInput, fallback: SimpleMockInput) {
  await env.rt.mocks.create(buildStub(integration, e, key), actor)
  await env.rt.mocks.create(buildStub(integration, e, { ...fallback, isDefault: true }), actor)
}
const call = async (path: string, init?: RequestInit) => {
  const res = await fetch(`${env.wm.url}${path}`, init)
  return { status: res.status, body: await res.text() }
}

test('JSON-body lookup: key mock and default match real requests', async () => {
  const e = endpoint({ key: 'cit', path: '/get-citizen-info', lookup: { location: 'jsonPath', expression: '$.idNo' } })
  await install(e, { keyValue: '1012345678', status: 200, body: '{"name":"Ali"}' }, { status: 404, body: '{}' })
  const post = (idNo: string) => call('/nic/get-citizen-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idNo }) })
  expect(await post('1012345678')).toEqual({ status: 200, body: '{"name":"Ali"}' })
  expect((await post('999')).status).toBe(404)
})

test('query-key lookup', async () => {
  const e = endpoint({ key: 'q', method: 'GET', path: '/lookup', lookup: { location: 'query', expression: 'id' } })
  await install(e, { keyValue: 'abc', status: 200, body: '{"hit":true}' }, { status: 404, body: '{}' })
  expect(await call('/nic/lookup?id=abc')).toEqual({ status: 200, body: '{"hit":true}' })
  expect((await call('/nic/lookup?id=zzz')).status).toBe(404)
})

test('path-template lookup', async () => {
  const e = endpoint({ key: 't', method: 'GET', path: '/users/{id}', pathType: 'template', lookup: { location: 'path', expression: 'id' } })
  await install(e, { keyValue: '42', status: 200, body: '{"id":42}' }, { status: 404, body: '{}' })
  expect(await call('/nic/users/42')).toEqual({ status: 200, body: '{"id":42}' })
  expect((await call('/nic/users/7')).status).toBe(404)
})

// Proxy and webhook targets are WireMock's own stub port as seen from inside the container (localhost:8080).
test('proxy mock: the real service answers, prefix stripped, headers added and removed', async () => {
  const upstream = endpoint({ key: 'up', method: 'GET', path: '/upstream/.*', pathType: 'regex' })
  await env.rt.mocks.create(buildStub({ ...integration, prefix: '/' }, upstream, { isDefault: true, status: 201, body: '{"from":"upstream"}' }), actor)
  const e = endpoint({ key: 'px', method: 'GET', path: '/accounts/.*', pathType: 'regex' })
  await env.rt.mocks.create(
    buildStub(integration, e, {
      isDefault: true,
      proxy: { baseUrl: 'http://localhost:8080/upstream', stripPrefix: '/nic', addHeaders: { 'X-Env': 'qa' }, removeHeaders: ['X-Secret'] },
    }),
    actor,
  )
  const res = await fetch(`${env.wm.url}/nic/accounts/7`, { headers: { 'X-Secret': 's' } })
  expect({ status: res.status, body: await res.text() }).toEqual({ status: 201, body: '{"from":"upstream"}' })
  const forwarded = (await env.rt.wiremock.listRequests({ limit: 20 })).find((r) => r.request.url === '/upstream/accounts/7')!
  expect(forwarded.request.headers?.['X-Env']).toBe('qa')
  expect(forwarded.request.headers?.['X-Secret']).toBeUndefined()
})

test('webhook mock: WireMock calls back after responding, with the templated body', async () => {
  const cb = endpoint({ key: 'cb', method: 'POST', path: '/callback', lookup: undefined })
  await env.rt.mocks.create(buildStub(integration, cb, { isDefault: true, status: 204 }), actor)
  const e = endpoint({ key: 'wh', path: '/pay', lookup: undefined })
  await env.rt.mocks.create(
    buildStub(integration, e, {
      isDefault: true,
      status: 202,
      webhook: {
        method: 'post',
        url: 'http://localhost:8080/nic/callback',
        headers: { 'Content-Type': 'application/json' },
        body: `{"paid":"{{jsonPath originalRequest.body '$.id'}}","same":"{{jsonPath request.body '$.id'}}"}`,
        delay: { type: 'uniform', lower: 10, upper: 50 },
      },
    }),
    actor,
  )
  expect((await call('/nic/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"abc"}' })).status).toBe(202)
  const until = Date.now() + 5000
  let callback
  while (!(callback = (await env.rt.wiremock.listRequests({ limit: 20 })).find((r) => r.request.url === '/nic/callback')) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(callback?.request.method).toBe('POST')
  // In a webhook template the incoming request is `originalRequest`; `request` is the callback itself (empty
  // body), so the editor's hint uses originalRequest.
  expect(callback?.request.body).toBe('{"paid":"abc","same":""}')
})

test('scenario mocks from the Simple form: pending, then approved; set and reset move it', async () => {
  const e = endpoint({ key: 'loan', method: 'GET', path: '/loan/status', lookup: { location: 'query', expression: 'id' } })
  const scenario = (requiredState: string | undefined, newState?: string) => ({ name: 'loan-approval', requiredState, newState })
  await env.rt.mocks.create(buildStub(integration, e, { keyValue: '7', status: 200, body: '{"status":"pending"}', name: 'Pending', scenario: scenario(undefined, 'approved') }), actor)
  await env.rt.mocks.create(buildStub(integration, e, { keyValue: '7', status: 200, body: '{"status":"approved"}', name: 'Approved', scenario: scenario('approved') }), actor)
  const status = async () => JSON.parse((await call('/nic/loan/status?id=7')).body).status
  const live = async () => (await env.rt.scenarios.list()).find((s) => s.name === 'loan-approval')!
  expect((await live()).state).toBe('Started')
  expect(await status()).toBe('pending')
  expect((await live()).state).toBe('approved')
  expect(await status()).toBe('approved')
  expect(await status()).toBe('approved')
  // Mocks are listed by id (random here), so compare as a set.
  expect((await live()).mocks.map((m) => [m.name, m.method, m.url, m.requiredState, m.newState])).toEqual(
    expect.arrayContaining([
      ['Pending', 'GET', '/nic/loan/status', 'Started', 'approved'],
      ['Approved', 'GET', '/nic/loan/status', 'approved', undefined],
    ]),
  )
  await env.rt.scenarios.setState('loan-approval', 'Started', 'ui-admin')
  expect(await status()).toBe('pending')
  await env.rt.scenarios.resetAll('ui-admin')
  expect((await live()).state).toBe('Started')
})
