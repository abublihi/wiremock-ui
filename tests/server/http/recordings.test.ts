import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getConfig } from '../../../src/server/http/handlers/config'
import { listMocks } from '../../../src/server/http/handlers/mocks'
import { listRequests } from '../../../src/server/http/handlers/requests'
import {
  acceptRecording,
  deleteRecording,
  discardRecordingItems,
  getRecording,
  listRecordings,
  recordingStatus,
  snapshotRecording,
  startRecording,
  stopRecording,
} from '../../../src/server/http/handlers/recordings'
import type { Recording } from '../../../src/server/recording/types'
import { BASELINE_PRUNED, RECORDING_DISABLED } from '../../../src/server/recording/service'
import type { Runtime } from '../../../src/server/runtime'
import { MARKER_ID } from '../../../src/server/sync/marker'
import { startRecordingPair } from '../../helpers/containers'
import { STORELESS, basic, req as baseReq, signIn, startTestRuntime } from '../../helpers/http'

// Spec A12 end to end on every driver: WireMock records from a second WireMock ("upstream"); the stubs wait in a
// review list and reach the store and WireMock only when accepted.

let pair: Awaited<ReturnType<typeof startRecordingPair>>
let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = auth) => baseReq(path, method, body, headers)
const W = () => pair.wm.url

const call = async (handler: (rt: Runtime, r: Request, p?: { id?: string }) => Promise<Response>, r: Request, id?: string) => {
  const res = await handler(rt, r, id ? { id } : undefined)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const start = (body: unknown) => call(startRecording, req('/api/recordings/start', 'POST', body))
const stop = () => call(stopRecording, req('/api/recordings/stop', 'POST'))
const status = () => call(recordingStatus, req('/api/recordings/status'))
const snapshot = (body: unknown) => call(snapshotRecording, req('/api/recordings/snapshot', 'POST', body))
const accept = (id: string, body: unknown) => call(acceptRecording, req(`/api/recordings/${id}/accept`, 'POST', body), id)
const mocks = async () => (await (await listMocks(rt, req('/api/mocks'))).json()) as { id: string; name?: string; request: Record<string, unknown>; priority?: number; metadata?: { wiremockUi?: Record<string, unknown> } }[]
const wmStubIds = async () => (await rt.wiremock.listStubIds()).filter((id) => id !== MARKER_ID)

beforeAll(async () => {
  pair = await startRecordingPair()
  env = await startTestRuntime('ui-admin', 'ui-admin-pass', { wm: pair.wm })
  rt = env.rt
  const up = pair.upstream.url
  const add = (stub: unknown) => fetch(`${up}/__admin/mappings`, { method: 'POST', body: JSON.stringify(stub) })
  await add({ request: { method: 'GET', urlPath: '/shop/items/1' }, response: { status: 200, jsonBody: { id: 1, name: 'Lamp' }, headers: { 'Content-Type': 'application/json' } } })
  await add({ request: { method: 'GET', urlPath: '/shop/search' }, response: { status: 200, body: 'found', headers: { 'Content-Type': 'text/plain' } } })
}, 180_000)
afterAll(async () => {
  await env?.stop()
  await pair?.stop()
})
beforeEach(async () => {
  if ((await rt.wiremock.recordingStatus()) === 'Recording') await rt.wiremock.stopRecording()
  for (const r of await rt.stores.recordings.list()) await rt.stores.recordings.delete(r.id)
  for (const m of await mocks()) await rt.mocks.delete(m.id, undefined, { username: 'ui-admin' } as never)
  await rt.wiremock.clearRequests()
})

test('start → call → stop: the stub waits in a review list; nothing reaches the store or WireMock', async () => {
  expect(await status()).toEqual({ status: 200, body: { status: 'idle' } })
  const started = await start({ targetUrl: pair.upstreamInternalUrl + '/', urlPathPattern: '/shop/*' })
  expect(started.status).toBe(200)
  expect(started.body).toMatchObject({ status: 'recording', target: pair.upstreamInternalUrl, startedBy: 'ui-admin' })
  expect((await status()).body).toMatchObject({ status: 'recording', target: pair.upstreamInternalUrl })
  expect(await rt.stores.recordings.getActive()).toMatchObject({ target: pair.upstreamInternalUrl, startedBy: 'ui-admin' })
  // The app's own mock list does not show WireMock's proxy stub.
  expect(await mocks()).toEqual([])

  expect(await (await fetch(`${W()}/shop/items/1`)).json()).toEqual({ id: 1, name: 'Lamp' })
  const stopped = await stop()
  expect(stopped.status).toBe(200)
  const rec = stopped.body.recording as Recording
  expect(rec).toMatchObject({ kind: 'recording', target: pair.upstreamInternalUrl, createdBy: 'ui-admin', dropped: 0 })
  expect(Date.parse(rec.expiresAt) - Date.parse(rec.createdAt)).toBe(24 * 60 * 60 * 1000)
  expect(rec.items).toHaveLength(1)
  expect(rec.items[0]).toMatchObject({ method: 'GET', url: '/shop/items/1', status: 200, bodySize: 22, contentType: 'application/json' })
  expect(rec.items[0].stub).toEqual({
    name: 'GET /shop/items/1',
    request: { method: 'GET', urlPath: '/shop/items/1' },
    response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { id: 1, name: 'Lamp' } },
  })

  expect(await mocks()).toEqual([])
  expect(await wmStubIds()).toEqual([])
  expect((await status()).body).toEqual({ status: 'idle' })
  const listed = (await call(listRecordings, req('/api/recordings'))).body.recordings
  expect(listed).toEqual([{ id: rec.id, kind: 'recording', target: pair.upstreamInternalUrl, createdBy: 'ui-admin', createdAt: rec.createdAt, expiresAt: rec.expiresAt, dropped: 0, itemCount: 1 }])
  // Another instance (or a restart) still knows who started a recording: it is in the store.
  const actions = (await rt.audit.list({ limit: 10 })).entries.map((e) => e.action)
  expect(actions).toEqual(expect.arrayContaining(['recording.start', 'recording.stop']))
})

test('accept creates mocks through the normal create path (quick form shape, owner, source); the list empties', async () => {
  await start({ targetUrl: pair.upstreamInternalUrl })
  await fetch(`${W()}/shop/items/1`)
  await fetch(`${W()}/shop/search?q=lamp`)
  const rec = (await stop()).body.recording as Recording
  const search = rec.items.find((i) => i.url === '/shop/search?q=lamp')!
  expect(search.stub.request).toEqual({ method: 'GET', urlPath: '/shop/search', queryParameters: { q: { equalTo: 'lamp' } } })

  const user = await signIn(rt, 'rita')
  const asRita = { Cookie: user.cookie, 'X-CSRF-Token': user.csrf }
  const res = await call(acceptRecording, baseReq(`/api/recordings/${rec.id}/accept`, 'POST', { items: [{ id: search.id, name: 'Search lamps' }] }, asRita), rec.id)
  expect(res.status).toBe(200)
  expect(res.body.failed).toEqual([])
  expect(res.body.created).toHaveLength(1)
  expect(res.body.recording.items.map((i: { id: string }) => i.id)).toEqual(rec.items.filter((i) => i !== search).map((i) => i.id))
  const [mock] = await mocks()
  expect(mock).toMatchObject({ id: res.body.created[0].mockId, name: 'Search lamps', metadata: { wiremockUi: { owner: user.username, source: 'recording', version: 1 } } })
  // WireMock now answers it as a mock (recording stopped, so not via the upstream).
  expect(await (await fetch(`${W()}/shop/search?q=lamp`)).text()).toBe('found')
  expect(await (await fetch(`${W()}/shop/search?q=other`)).status).toBe(404)

  const rest = await accept(rec.id, { items: [{ id: rec.items.find((i) => i !== search)!.id }], owner: 'baseline' })
  expect(rest.body.recording).toBeNull()
  expect((await mocks()).find((m) => m.id === rest.body.created[0].mockId)?.metadata?.wiremockUi?.owner).toBe('baseline')
  expect((await call(getRecording, req(`/api/recordings/${rec.id}`), rec.id)).status).toBe(404)
  expect((await rt.audit.list({ limit: 5 })).entries.map((e) => e.action)).toContain('recording.accept')
})

test('accept into a new endpoint builds the Simple editor\'s default mock; an unknown item fails alone', async () => {
  await rt.catalog.upsertIntegration({ key: 'shop', name: 'Shop', prefix: '/shop' }, 'ui-admin')
  await start({ targetUrl: pair.upstreamInternalUrl })
  await fetch(`${W()}/shop/items/1`)
  const rec = (await stop()).body.recording as Recording
  const res = await accept(rec.id, {
    items: [
      { id: rec.items[0].id, integration: 'shop', newEndpoint: { key: 'get-item', name: 'Get item' } },
      { id: 'nope' },
    ],
  })
  expect(res.body.failed).toEqual([{ id: 'nope', error: 'Not in this review list (accepted or discarded already)' }])
  const endpoint = await rt.catalog.getEndpoint('shop', 'get-item')
  expect(endpoint).toMatchObject({ method: 'GET', path: '/items/1', pathType: 'exact', contentType: 'json', exampleResponses: { '200': '{\n  "id": 1,\n  "name": "Lamp"\n}' } })
  const [mock] = await mocks()
  expect(mock).toMatchObject({
    priority: 10,
    request: { method: 'GET', urlPath: '/shop/items/1' },
    metadata: { wiremockUi: { integration: 'shop', endpoint: 'get-item', source: 'recording' } },
  })
  await rt.catalog.deleteEndpoint('shop', 'get-item', 'x').catch(() => {})
})

test('start validates the target: http(s) only, never WireMock itself or this app; one recording at a time', async () => {
  expect(await start({ targetUrl: 'ftp://x.example' })).toEqual({ status: 400, body: { error: 'Target URL must start with http:// or https://', field: 'targetUrl' } })
  expect((await start({ targetUrl: W() })).body.error).toMatch(/^Target URL is WireMock itself/)
  expect((await start({ targetUrl: 'http://ui.test/x' })).body.error).toMatch(/^Target URL is this app/)
  // WireMock connects to the target: a loopback host on its own port is WireMock itself.
  const port = new URL(W()).port
  for (const host of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0']) expect((await start({ targetUrl: `http://${host}:${port}` })).body.error, host).toMatch(/^Target URL is WireMock itself/)
  expect((await start({ targetUrl: pair.upstreamInternalUrl, urlPathPattern: '[' })).body.error).toBe('urlPathPattern is not a valid regular expression')
  expect((await start({ targetUrl: pair.upstreamInternalUrl, extra: 1 })).body.error).toBe('unknown field: extra')
  expect(await rt.wiremock.recordingStatus()).not.toBe('Recording')
  expect((await start({ targetUrl: pair.upstreamInternalUrl })).status).toBe(200)
  expect(await start({ targetUrl: pair.upstreamInternalUrl })).toEqual({ status: 409, body: { error: 'A recording is already running. Stop it before starting another one.' } })
  expect((await stop()).body.recording).toBeNull()
  expect(await stop()).toEqual({ status: 409, body: { error: 'No recording is running' } })
})

test('an empty stop says why: requests went through but the filters left them out, or nothing reached WireMock', async () => {
  expect((await start({ targetUrl: pair.upstreamInternalUrl, urlPathPattern: '/api/Products?limit=3' })).status).toBe(200)
  await fetch(`${W()}/shop/items/1`)
  expect((await stop()).body).toEqual({ recording: null, empty: { reason: 'filtered', requests: 1, filters: { urlPathPattern: '^/api/Products$' }, paths: ['/shop/items/1'] } })

  await rt.wiremock.clearRequests()
  expect((await start({ targetUrl: pair.upstreamInternalUrl })).status).toBe(200)
  expect((await stop()).body).toEqual({ recording: null, empty: { reason: 'noTraffic', wiremockUrl: expect.any(String) } })
})

test('snapshot from the request log: picked ids, duplicate of an existing mock, unmatched requests flagged; discard', async () => {
  const created = await rt.mocks.create({ name: 'Hello', request: { method: 'GET', urlPath: '/hello' }, response: { status: 200, body: 'hi' } }, { username: 'ui-admin' } as never)
  await fetch(`${W()}/hello`)
  await fetch(`${W()}/missing`)
  const log = (await (await listRequests(rt, req('/api/requests'))).json()) as { requests?: { id: string }[] } | { id: string }[]
  const entries = Array.isArray(log) ? log : (log.requests ?? [])
  expect(entries.length).toBeGreaterThanOrEqual(2)

  const all = await snapshot({})
  expect(all.status).toBe(200)
  const rec = all.body.recording as Recording
  const hello = rec.items.find((i) => i.url === '/hello')!
  const missing = rec.items.find((i) => i.url === '/missing')!
  expect(hello.duplicateOf).toEqual({ id: created.id, name: 'Hello' })
  expect(hello.stub.response).toEqual({ status: 200, body: 'hi' })
  expect(missing).toMatchObject({ status: 404, unmatched: true })
  expect(hello.unmatched).toBeUndefined()
  // Snapshot stubs are removed from WireMock again; only the existing mock remains.
  expect(await wmStubIds()).toEqual([created.id])

  const discarded = await call(discardRecordingItems, req(`/api/recordings/${rec.id}/discard`, 'POST', { ids: [missing.id] }), rec.id)
  expect(discarded.body.recording.items.map((i: { id: string }) => i.id)).toEqual([hello.id])
  expect((await call(deleteRecording, req(`/api/recordings/${rec.id}`, 'DELETE'), rec.id)).status).toBe(204)
  expect((await call(getRecording, req(`/api/recordings/${rec.id}`), rec.id)).status).toBe(404)

  const picked = await snapshot({ ids: [entries[0].id] })
  expect(picked.body.recording.items).toHaveLength(1)
  expect((await snapshot({ method: 'POST' })).body).toEqual({ recording: null, empty: { reason: 'filtered', requests: expect.any(Number), filters: { method: 'POST' }, paths: expect.arrayContaining(['/hello', '/missing']) } })
  // Paths to record is a wildcard: /hel* takes the logged GET /hello.
  expect((await snapshot({ urlPathPattern: '/hel*' })).body.recording.items.map((i: { url: string }) => i.url)).toEqual(['/hello'])
  expect((await snapshot({ urlPathPattern: 'hello?x=1', urlPathMode: 'regex' })).body).toEqual({ error: 'urlPathPattern matches the path only, without the query string. To record /hello?x=1 use /hello.*', field: 'urlPathPattern' })
  expect((await snapshot({ ids: [] })).body).toEqual({ error: 'ids must not be empty', field: 'ids' })
  expect((await rt.audit.list({ limit: 10 })).entries.map((e) => e.action)).toEqual(expect.arrayContaining(['recording.snapshot', 'recording.discard']))
})

test.skipIf(STORELESS)('a full sync during a recording keeps WireMock\'s proxy stub', async () => {
  await start({ targetUrl: pair.upstreamInternalUrl })
  await rt.reconciler!.fullSync()
  expect(await (await fetch(`${W()}/shop/items/1`)).json()).toEqual({ id: 1, name: 'Lamp' })
  expect((await stop()).body.recording.items).toHaveLength(1)
})

test('RECORDING_ALLOWED=false: 403 with a clear message on every recording route; /api/config says so', async () => {
  rt.config.recordingAllowed = false
  try {
    const forbidden = { status: 403, body: { error: RECORDING_DISABLED } }
    expect(await status()).toEqual(forbidden)
    expect(await start({ targetUrl: pair.upstreamInternalUrl })).toEqual(forbidden)
    expect(await stop()).toEqual(forbidden)
    expect(await snapshot({})).toEqual(forbidden)
    expect(await call(listRecordings, req('/api/recordings'))).toEqual(forbidden)
    expect(await call(getRecording, req('/api/recordings/x'), 'x')).toEqual(forbidden)
    expect(await accept('x', { items: [{ id: 'a' }] })).toEqual(forbidden)
    expect(await call(deleteRecording, req('/api/recordings/x', 'DELETE'), 'x')).toEqual(forbidden)
    expect((await call(getConfig, req('/api/config'))).body.recordingAllowed).toBe(false)
    expect(await rt.wiremock.recordingStatus()).not.toBe('Recording')
  } finally {
    rt.config.recordingAllowed = true
  }
})

test('two recordings of one endpoint become two scenarios when accepted; each replays its own chain', async () => {
  const up = pair.upstream.url
  const answers = ['one', 'two', 'three', 'four']
  for (const [n, body] of answers.entries()) {
    await fetch(`${up}/__admin/mappings`, {
      method: 'POST',
      body: JSON.stringify({
        scenarioName: 'seq',
        requiredScenarioState: n === 0 ? 'Started' : `s${n}`,
        newScenarioState: `s${n + 1}`,
        request: { method: 'GET', urlPath: '/shop/seq' },
        response: { status: 200, body },
      }),
    })
  }
  await fetch(`${up}/__admin/scenarios/reset`, { method: 'POST' })
  const record = async () => {
    await start({ targetUrl: pair.upstreamInternalUrl, urlPathPattern: '/shop/seq' })
    await fetch(`${W()}/shop/seq`)
    await fetch(`${W()}/shop/seq`)
    const rec = (await stop()).body.recording as Recording
    expect(rec.items).toHaveLength(2)
    expect((await accept(rec.id, { items: rec.items.map((i) => ({ id: i.id })) })).body.failed).toEqual([])
    return rec
  }
  const first = await record()
  const second = await record()
  const nameOf = (rec: Recording) => rec.items[0].stub.scenarioName as string
  expect(nameOf(first)).toMatch(/^GET-shop-seq-recorded-\d{4}-\d{2}-\d{2}-\d{4}$/)
  expect(nameOf(second)).not.toBe(nameOf(first))
  for (const rec of [first, second]) {
    const name = nameOf(rec)
    const states = rec.items.map((i) => [i.stub.scenarioName, i.stub.requiredScenarioState, i.stub.newScenarioState]).sort((a, b) => (a[1] === 'Started' ? -1 : b[1] === 'Started' ? 1 : 0))
    expect(states).toEqual([
      [name, 'Started', `${name}-2`],
      [name, `${name}-2`, undefined],
    ])
  }
  expect((await wmStubIds()).sort()).toEqual((await mocks()).map((m) => m.id).sort())
  // WireMock may still list the recording's own scenario name for a moment after its stubs are removed.
  expect((await rt.wiremock.listScenarios()).map((s) => s.name)).toEqual(expect.arrayContaining([nameOf(first), nameOf(second)]))

  // The newer recording answers first (newest wins); without it the older one replays its own two answers.
  await rt.wiremock.resetScenarios()
  expect([await (await fetch(`${W()}/shop/seq`)).text(), await (await fetch(`${W()}/shop/seq`)).text()]).toEqual(['three', 'four'])
  for (const m of await mocks()) {
    if ((m as { scenarioName?: string }).scenarioName === nameOf(second)) await rt.mocks.delete(m.id, undefined, { username: 'ui-admin' } as never)
  }
  await rt.wiremock.resetScenarios()
  expect([await (await fetch(`${W()}/shop/seq`)).text(), await (await fetch(`${W()}/shop/seq`)).text()]).toEqual(['one', 'two'])
})

test.skipIf(STORELESS)('SEED_PRUNE on: accepting as baseline is refused (a restart would delete them); as my own works; /api/config says so', async () => {
  await start({ targetUrl: pair.upstreamInternalUrl })
  await fetch(`${W()}/shop/items/1`)
  const rec = (await stop()).body.recording as Recording
  const before = { seedPrune: rt.config.seedPrune, seedPath: rt.config.seedPath }
  rt.config.seedPrune = true
  rt.config.seedPath = '/seed'
  try {
    expect(await accept(rec.id, { items: [{ id: rec.items[0].id }], owner: 'baseline' })).toEqual({ status: 400, body: { error: BASELINE_PRUNED } })
    expect((await call(getConfig, req('/api/config'))).body.seedPrune).toBe(true)
    expect(await mocks()).toEqual([])
    const mine = await accept(rec.id, { items: [{ id: rec.items[0].id }] })
    expect(mine.body.created).toHaveLength(1)
  } finally {
    Object.assign(rt.config, before)
  }
  expect((await call(getConfig, req('/api/config'))).body.seedPrune).toBe(false)
})
