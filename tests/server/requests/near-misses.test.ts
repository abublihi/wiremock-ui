import { afterAll, beforeAll, expect, test } from 'vitest'
import { buildStub } from '../../../src/server/catalog/build'
import type { Endpoint, Integration } from '../../../src/server/catalog/types'
import { NotFoundError } from '../../../src/server/errors'
import { login, req, startTestRuntime } from '../../helpers/http'
import { nearMisses } from '../../../src/server/http/handlers/requests'

let env: Awaited<ReturnType<typeof startTestRuntime>>
const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
const endpoint: Endpoint = {
  integration: 'nic', key: 'cit', name: 'Citizen', method: 'POST', path: '/get-citizen-info', pathType: 'exact', contentType: 'json',
  exampleResponses: {}, allowedStatuses: [], updatedAt: '', updatedBy: '',
  lookup: { location: 'jsonPath', expression: '$.idNo' },
}
const post = (path: string, body: unknown) =>
  fetch(`${env.wm.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function lastId() {
  const rows = await env.rt.requests.list({ limit: 1 })
  return rows[0].id
}

beforeAll(async () => {
  env = await startTestRuntime()
  const admin = (await env.rt.users.list()).find((u) => u.username === 'ui-admin')!
  await env.rt.catalog.upsertIntegration({ key: 'nic', name: 'NIC', prefix: '/nic' }, 'ui-admin')
  await env.rt.mocks.create(
    buildStub(integration, endpoint, { keyValue: '1012345678', status: 200, body: '{"name":"Ali"}' }),
    admin,
  )
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

test('an unmatched request explains the closest stub field by field', async () => {
  await env.rt.requests.clear('ui-admin')
  expect((await post('/nic/get-citizen-info', { idNo: '999' })).status).toBe(404)
  const misses = await env.rt.requests.nearMisses(await lastId())
  expect(misses.length).toBeGreaterThan(0)
  expect(misses.length).toBeLessThanOrEqual(3)
  const [first] = misses
  expect(first.stub).toMatchObject({ owner: 'ui-admin', integration: 'nic' })
  expect(first.diffs.find((d) => d.field === 'method')).toMatchObject({ matched: true })
  expect(first.diffs.find((d) => d.field === 'urlPath')).toMatchObject({ matched: true })
  expect(first.diffs.find((d) => d.field === 'body')).toEqual({
    field: 'body',
    expected: 'matchesJsonPath $.idNo equalTo 1012345678',
    actual: '999',
    matched: false,
  })
  expect(misses.map((m) => m.distance)).toEqual([...misses.map((m) => m.distance)].sort((a, b) => a - b))
})

test('a matched request has no near misses; unknown ids are NotFound', async () => {
  await env.rt.requests.clear('ui-admin')
  expect((await post('/nic/get-citizen-info', { idNo: '1012345678' })).status).toBe(200)
  expect(await env.rt.requests.nearMisses(await lastId())).toEqual([])
  await expect(env.rt.requests.nearMisses('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundError)
  await expect(env.rt.requests.nearMisses('nope')).rejects.toBeInstanceOf(NotFoundError)
})

test('the endpoint returns near misses for requests.read and rejects anonymous callers', async () => {
  await env.rt.requests.clear('ui-admin')
  await post('/nic/get-citizen-info', { idNo: '1' })
  const id = await lastId()
  const { cookie } = await login(env.rt, 'ui-admin', 'ui-admin-pass')
  const ok = await nearMisses(env.rt, req(`/api/requests/${id}/near-misses`, 'GET', undefined, { Cookie: cookie }), { id })
  expect(ok.status).toBe(200)
  expect((await ok.json())[0].diffs.length).toBeGreaterThan(0)
  const anon = await nearMisses(env.rt, req(`/api/requests/${id}/near-misses`), { id })
  expect(anon.status).toBe(401)
})
