import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { ValidationError } from '../../../src/server/errors'
import { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startRecordingPair } from '../../helpers/containers'

// Pins WireMock 3.13.1's recorder (`/__admin/recordings/*`), which spec amendment A12 builds on. The target is a
// second WireMock on the same Docker network ("upstream"), standing in for the real service.

let pair: Awaited<ReturnType<typeof startRecordingPair>>
let wm: WireMockClient
let UP: string
let W: string

const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeAll(async () => {
  pair = await startRecordingPair()
  wm = new WireMockClient({ baseUrl: pair.wm.url, user: pair.wm.user, password: pair.wm.password })
  UP = pair.upstream.url
  W = pair.wm.url
})
afterAll(async () => {
  await pair?.stop()
})
beforeEach(async () => {
  await pair.wm.restart()
  await pair.upstream.restart()
  if ((await wm.recordingStatus()) === 'Recording') await wm.stopRecording()
  await post(`${UP}/__admin/mappings`, {
    request: { method: 'GET', urlPath: '/api/users/1' },
    response: { status: 200, jsonBody: { id: 1, name: 'Ann' }, headers: { 'Content-Type': 'application/json' } },
  })
  await post(`${UP}/__admin/mappings`, { request: { method: 'GET', urlPath: '/other' }, response: { status: 200, body: 'other' } })
  await post(`${UP}/__admin/mappings`, { request: { method: 'POST', urlPath: '/api/orders' }, response: { status: 201, body: 'created' } })
  for (const [state, next, body] of [['Started', 'two', 'one'], ['two', undefined, 'two']] as const) {
    await post(`${UP}/__admin/mappings`, {
      scenarioName: 's',
      requiredScenarioState: state,
      ...(next ? { newScenarioState: next } : {}),
      request: { method: 'GET', urlPath: '/api/count' },
      response: { status: 200, body },
    })
  }
})

const ids = (stubs: StubMapping[]) => stubs.map((s) => s.id).sort()

test('start adds one proxy stub without metadata; status goes NeverStarted → Recording → Stopped', async () => {
  expect(await wm.recordingStatus()).toBe('NeverStarted')
  await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, persist: false })
  expect(await wm.recordingStatus()).toBe('Recording')
  const during = await wm.listStubs()
  expect(during).toHaveLength(1)
  expect(during[0]).toMatchObject({ request: { method: 'ANY' }, response: { status: 200, proxyBaseUrl: pair.upstreamInternalUrl } })
  expect(during[0].metadata).toBeUndefined()
  expect(Object.keys(during[0].request)).toEqual(['method'])
  expect(await (await fetch(`${W}/api/users/1`)).json()).toEqual({ id: 1, name: 'Ann' })
  const recorded = await wm.stopRecording()
  expect(await wm.recordingStatus()).toBe('Stopped')
  expect(recorded).toHaveLength(1)
  // The proxy stub is gone again.
  expect((await wm.listStubs()).some((s) => s.response.proxyBaseUrl !== undefined)).toBe(false)
})

test('persist: false still adds the recorded stubs to WireMock (the UI must delete them)', async () => {
  await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, persist: false })
  await fetch(`${W}/api/users/1`)
  await fetch(`${W}/other?a=1&b=2&b=3`)
  const recorded = (await wm.stopRecording())!
  expect(ids(await wm.listStubs())).toEqual(ids(recorded))
  // Without a query WireMock records `url`; with one, `urlPath` plus hasExactly query matchers.
  expect(recorded.find((s) => s.request.urlPath === '/other')?.request).toEqual({
    urlPath: '/other',
    method: 'GET',
    queryParameters: { a: { hasExactly: [{ equalTo: '1' }] }, b: { hasExactly: [{ equalTo: '2' }, { equalTo: '3' }] } },
  })
  const users = recorded.find((s) => s.request.url === '/api/users/1')!
  expect(users).toMatchObject({ name: 'api_users_1', request: { url: '/api/users/1', method: 'GET' }, response: { status: 200 } })
  expect(users.persistent).toBeUndefined()
})

test('bodies stay inline without extractBodyCriteria: text under a Content-Type as body, without one as base64Body', async () => {
  await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, persist: false })
  await fetch(`${W}/api/users/1`)
  await fetch(`${W}/other`)
  const recorded = (await wm.stopRecording())!
  const users = recorded.find((s) => s.request.url === '/api/users/1')!
  expect(users.response.body).toBe('{"id":1,"name":"Ann"}')
  expect(users.response.headers).toMatchObject({ 'Content-Type': 'application/json' })
  // WireMock's own Matched-Stub-Id header from the upstream is recorded like any other header.
  expect(Object.keys(users.response.headers as object)).toContain('Matched-Stub-Id')
  const other = recorded.find((s) => s.request.url === '/other')!
  expect(other.response.base64Body).toBe(Buffer.from('other').toString('base64'))
  expect(other.response.body).toBeUndefined()
})

test('extractBodyCriteria writes bodyFileName files into WireMock even with persist: false', async () => {
  await wm.startRecording({
    targetBaseUrl: pair.upstreamInternalUrl,
    persist: false,
    extractBodyCriteria: { textSizeThreshold: '0', binarySizeThreshold: '0' },
  })
  await fetch(`${W}/api/users/1`)
  const [users] = (await wm.stopRecording())!
  expect(users.response.bodyFileName).toMatch(/^api_users_1-.*\.json$/)
  expect(users.response.body).toBeUndefined()
  const files = await (await fetch(`${W}/__admin/files`, { headers: { Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` } })).json()
  expect(files).toContain(users.response.bodyFileName)
})

test('filters: the proxy stub forwards everything, only matching requests become stubs; captureHeaders and bodies', async () => {
  await wm.startRecording({
    targetBaseUrl: pair.upstreamInternalUrl,
    persist: false,
    filters: { method: 'POST', urlPathPattern: '/api/.*' },
    captureHeaders: { Accept: {} },
  })
  expect((await wm.listStubs())[0].request).toEqual({ method: 'ANY' })
  expect((await fetch(`${W}/other`)).status).toBe(200)
  expect((await fetch(`${W}/api/users/1`)).status).toBe(200)
  expect((await post(`${W}/api/orders`, { item: 'a' })).status).toBe(201)
  const recorded = (await wm.stopRecording())!
  expect(recorded).toHaveLength(1)
  expect(recorded[0].request).toEqual({
    url: '/api/orders',
    method: 'POST',
    headers: { Accept: { equalTo: '*/*' } },
    bodyPatterns: [{ equalToJson: '{"item":"a"}', ignoreArrayOrder: true, ignoreExtraElements: true }],
  })
})

test('repeatsAsScenarios: true chains repeated requests as a scenario; false keeps only the last response', async () => {
  await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, persist: false, repeatsAsScenarios: true })
  await fetch(`${W}/api/count`)
  await fetch(`${W}/api/count`)
  const chained = (await wm.stopRecording())!
  expect(chained).toHaveLength(2)
  const first = chained.find((s) => s.requiredScenarioState === 'Started')!
  const second = chained.find((s) => s.requiredScenarioState !== 'Started')!
  expect(first.scenarioName).toBe('scenario-1-api-count')
  expect(first.newScenarioState).toBe(second.requiredScenarioState)
  expect(Buffer.from(String(first.response.base64Body), 'base64').toString()).toBe('one')
  expect(Buffer.from(String(second.response.base64Body), 'base64').toString()).toBe('two')

  await wm.resetScenarios()
  await post(`${UP}/__admin/scenarios/reset`)
  await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, persist: false, repeatsAsScenarios: false })
  await fetch(`${W}/api/count`)
  await fetch(`${W}/api/count`)
  const single = (await wm.stopRecording())!
  expect(single).toHaveLength(1)
  expect(single[0].scenarioName).toBeUndefined()
  expect(Buffer.from(String(single[0].response.base64Body), 'base64').toString()).toBe('two')
})

test('a stub with a better priority answers before the proxy stub and is not recorded; a default-priority one is', async () => {
  await wm.importStubs(
    [
      { id: '00000000-0000-4000-8000-000000000001', priority: 1, request: { method: 'GET', urlPath: '/api/users/1' }, response: { status: 299 } },
      { id: '00000000-0000-4000-8000-000000000002', request: { method: 'GET', urlPath: '/other' }, response: { status: 298 } },
    ],
    { deleteAllNotInImport: false },
  )
  await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, persist: false })
  expect((await fetch(`${W}/api/users/1`)).status).toBe(299)
  expect((await fetch(`${W}/other`)).status).toBe(200)
  const recorded = (await wm.stopRecording())!
  expect(recorded.map((s) => s.request.url)).toEqual(['/other'])
})

test('the journal keeps proxied requests (matched by the proxy stub); stop when not recording is null', async () => {
  await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, persist: false })
  const proxyId = (await wm.listStubs())[0].id
  await fetch(`${W}/api/users/1`)
  await wm.stopRecording()
  const journal = await wm.listRequests({ limit: 10 })
  expect(journal).toHaveLength(1)
  expect(journal[0]).toMatchObject({ wasMatched: true, request: { url: '/api/users/1' } })
  expect(journal[0].stubMapping?.id).toBe(proxyId)
  expect(await wm.stopRecording()).toBeNull()
})

test('start does not validate the target URL or method; a bad regex is a 422 the client reports as a ValidationError', async () => {
  await wm.startRecording({ targetBaseUrl: 'not a url', persist: false })
  expect(await wm.recordingStatus()).toBe('Recording')
  await wm.stopRecording()
  const err = await wm.startRecording({ targetBaseUrl: pair.upstreamInternalUrl, filters: { urlPathPattern: '[' } }).catch((e) => e)
  expect(err).toBeInstanceOf(ValidationError)
  expect(err.message).toMatch(/^Error parsing JSON: Unclosed character class/)
  expect(await wm.recordingStatus()).toBe('Stopped')
})

test('snapshot: proxied requests only by default; allowNonProxied takes the whole journal (unmatched as 404); ids pick entries', async () => {
  await wm.importStubs([{ id: '00000000-0000-4000-8000-000000000003', request: { method: 'GET', urlPath: '/local' }, response: { status: 200, body: 'local' } }], {
    deleteAllNotInImport: false,
  })
  await fetch(`${W}/local`)
  await fetch(`${W}/nothing`)
  expect(await wm.snapshotRecording({ persist: false })).toEqual([])

  const all = await wm.snapshotRecording({ persist: false, filters: { allowNonProxied: true } })
  expect(all.map((s) => [s.request.url, s.response.status]).sort()).toEqual([['/local', 200], ['/nothing', 404]])
  // Snapshot stubs are added to WireMock as well.
  expect((await wm.listStubs()).length).toBe(3)

  const [local] = (await wm.listRequests({ limit: 10 })).filter((e) => e.request.url === '/local')
  const picked = await wm.snapshotRecording({ persist: false, filters: { allowNonProxied: true, ids: [local.id] } })
  expect(picked.map((s) => s.request.url)).toEqual(['/local'])
  expect(picked[0].response.headers).toMatchObject({ 'Matched-Stub-Id': '00000000-0000-4000-8000-000000000003' })
  expect(await wm.snapshotRecording({ persist: false, filters: { allowNonProxied: true, ids: [] } })).toEqual([])
})
