import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { WireMockMockStore } from '../../../src/server/store/wiremock'
import { MARKER_ID, markerStub } from '../../../src/server/sync/marker'
import { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startWireMock, type WireMockHandle } from '../../helpers/containers'

const ID1 = '1111aaaa-1111-4111-8111-111111111111'
const ID2 = '2222aaaa-2222-4222-8222-222222222222'
const ID3 = '3333aaaa-3333-4333-8333-333333333333'

let handle: WireMockHandle
let client: WireMockClient
let store: WireMockMockStore

const plain = (id: string, path: string, extra: Partial<StubMapping> = {}): StubMapping => ({
  id,
  request: { method: 'GET', urlPath: path },
  response: { status: 200, body: path },
  ...extra,
})
const managed = (id: string, path: string, meta: Record<string, unknown>): StubMapping =>
  plain(id, path, {
    persistent: false,
    metadata: { wiremockUi: { owner: 'sara', version: 3, updatedAt: '2026-02-01T00:00:00.000Z', updatedBy: 'sara', source: 'ui', ...meta } as never },
  })

beforeAll(async () => {
  handle = await startWireMock()
  client = new WireMockClient({ baseUrl: handle.url, user: handle.user, password: handle.password })
  store = new WireMockMockStore(client)
}, 120_000)
afterAll(async () => {
  await handle?.stop()
})
beforeEach(async () => {
  await client.importStubs([], { deleteAllNotInImport: true })
})

test('stubs made outside the UI are presented as version 1 owned by wiremock; the marker is hidden', async () => {
  await client.importStubs([plain(ID1, '/a', { metadata: { team: 'qa' } }), markerStub()], { deleteAllNotInImport: false })
  const got = await store.get(ID1)
  expect(got?.metadata).toEqual({
    team: 'qa',
    wiremockUi: { owner: 'wiremock', version: 1, updatedAt: '', updatedBy: 'wiremock', source: 'adopt' },
  })
  expect(got?.uuid).toBeUndefined()
  expect(await store.get(MARKER_ID)).toBeNull()
  expect((await store.listAll()).map((s) => s.id)).toEqual([ID1])
  expect(await store.get('nope')).toBeNull()
  await expect(store.delete('nope')).resolves.toBeUndefined()
})

test('list filters by integration and owner in memory, newest update first', async () => {
  await client.importStubs(
    [
      managed(ID1, '/a', { integration: 'pay', updatedAt: '2026-01-01T00:00:00.000Z' }),
      managed(ID2, '/b', { integration: 'pay', owner: 'omar', updatedAt: '2026-03-01T00:00:00.000Z' }),
      plain(ID3, '/c'),
    ],
    { deleteAllNotInImport: false },
  )
  expect((await store.list()).map((s) => s.id)).toEqual([ID2, ID1, ID3])
  expect((await store.list({ integration: 'pay' })).map((s) => s.id)).toEqual([ID2, ID1])
  expect((await store.list({ owner: 'wiremock' })).map((s) => s.id)).toEqual([ID3])
  expect((await store.list({ integration: 'pay', owner: 'sara' })).map((s) => s.id)).toEqual([ID1])
})

test('save checks the live version: 0 = must not exist; a stale version is a conflict; WireMock serves the write', async () => {
  const next = managed(ID1, '/a', { version: 1 })
  await store.save(next, 0)
  expect(await (await fetch(`${handle.url}/a`)).text()).toBe('/a')
  await expect(store.save(next, 0)).rejects.toMatchObject({ status: 409 })
  await expect(store.save(managed(ID1, '/a', { version: 3 }), 2)).rejects.toMatchObject({ status: 409 })
  await store.save({ ...managed(ID1, '/a2', { version: 2 }) }, 1)
  expect((await store.get(ID1))?.metadata?.wiremockUi?.version).toBe(2)

  // An outside stub counts as version 1.
  await client.importStubs([plain(ID2, '/b')], { deleteAllNotInImport: false })
  await expect(store.save(managed(ID2, '/b', { version: 3 }), 2)).rejects.toMatchObject({ status: 409 })
  await store.save(managed(ID2, '/b', { version: 2 }), 1)
  expect((await store.get(ID2))?.metadata?.wiremockUi).toMatchObject({ owner: 'sara', version: 2 })
})

test('save keeps a persistent stub persistent', async () => {
  await client.importStubs([plain(ID3, '/p', { persistent: true })], { deleteAllNotInImport: false })
  await store.save(managed(ID3, '/p', { version: 2 }), 1)
  expect((await client.getStub(ID3))?.persistent).toBe(true)
})

test('delete checks the version when given; a missing id resolves; history is empty and locks are always granted', async () => {
  await client.importStubs([plain(ID1, '/a')], { deleteAllNotInImport: false })
  await expect(store.delete(ID1, 4)).rejects.toMatchObject({ status: 409 })
  await store.delete(ID1, 1)
  expect(await client.getStub(ID1)).toBeNull()
  await expect(store.delete(ID1)).resolves.toBeUndefined()
  expect(await store.history(ID1)).toEqual([])
  const a = await store.acquireLock('sync:lock', 1000)
  const b = await store.acquireLock('sync:lock', 1000)
  expect(a && b && a !== b).toBe(true)
  expect(await store.ping()).toBe(true)
})
