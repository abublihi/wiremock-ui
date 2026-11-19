import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { WireMockClient } from '../../../src/server/wiremock/client'
import { startWireMock, type WireMockHandle } from '../../helpers/containers'

const ID1 = '11111111-1111-4111-8111-111111111111'
let handle: WireMockHandle
let wm: WireMockClient
const hit = (path: string, init?: RequestInit) => fetch(`${handle.url}${path}`, init)

beforeAll(async () => {
  handle = await startWireMock()
  wm = new WireMockClient({ baseUrl: handle.url, user: handle.user, password: handle.password })
})
afterAll(async () => {
  await handle?.stop()
})
beforeEach(async () => {
  await wm.clearRequests()
  await wm.importStubs(
    [{ id: ID1, name: 'create', persistent: false, request: { method: 'POST', urlPath: '/x' }, response: { status: 201, body: 'ok' } }],
    { deleteAllNotInImport: true },
  )
})

test('listRequests returns newest-first events with the pinned 3.13.1 shape', async () => {
  await hit('/x?a=1', { method: 'POST', body: 'hello' })
  await hit('/nomatch')
  const [unmatched, matched] = await wm.listRequests({ limit: 10 })
  expect(unmatched).toMatchObject({ wasMatched: false, request: { url: '/nomatch', method: 'GET' }, response: { status: 404 } })
  // Unmatched events carry a synthetic stubMapping that is not one of ours.
  expect(unmatched.stubMapping?.id).not.toBe(ID1)
  expect(matched).toMatchObject({
    wasMatched: true,
    request: { url: '/x?a=1', method: 'POST', body: 'hello' },
    response: { status: 201, body: 'ok' },
    responseDefinition: { status: 201 },
    stubMapping: { id: ID1, name: 'create' },
  })
  expect(typeof matched.request.loggedDateString).toBe('string')
  expect(typeof matched.request.loggedDate).toBe('number')
  expect(typeof matched.timing?.totalTime).toBe('number')
  expect(await wm.listRequests({ limit: 1 })).toHaveLength(1)
})

test('since filters by logged date; a malformed since is rejected', async () => {
  await hit('/nomatch')
  expect(await wm.listRequests({ limit: 10, since: '2999-01-01T00:00:00Z' })).toEqual([])
  expect(await wm.listRequests({ limit: 10, since: '2000-01-01T00:00:00Z' })).toHaveLength(1)
  await expect(wm.listRequests({ limit: 10, since: 'garbage' })).rejects.toThrow(/ISO8601/)
})

test('getRequest returns the event, null when unknown', async () => {
  await hit('/x', { method: 'POST', body: 'b' })
  const [e] = await wm.listRequests({ limit: 1 })
  expect((await wm.getRequest(e.id))?.request.body).toBe('b')
  expect(await wm.getRequest('00000000-0000-4000-8000-000000000000')).toBeNull()
})

test('countRequests, clearRequests', async () => {
  await hit('/x', { method: 'POST' })
  await hit('/x', { method: 'POST' })
  await hit('/x')
  expect(await wm.countRequests({ method: 'POST', urlPath: '/x' })).toBe(2)
  await wm.clearRequests()
  expect(await wm.listRequests({ limit: 10 })).toEqual([])
  expect(await wm.countRequests({ method: 'POST', urlPath: '/x' })).toBe(0)
})

test('nearMisses ranks stubs for a logged request', async () => {
  const misses = await wm.nearMisses({ method: 'POST', url: '/xx' })
  expect(misses[0].stubMapping.id).toBe(ID1)
  expect(typeof misses[0].matchResult.distance).toBe('number')
})
