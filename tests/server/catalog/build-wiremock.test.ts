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
const actor = { id: 'a', username: 'ui-admin', displayName: 'a', role: 'admin', disabled: false, createdAt: '', updatedAt: '' } as const

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
