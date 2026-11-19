import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { ValidationError } from '../../../src/server/errors'
import { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startWireMock, type WireMockHandle } from '../../helpers/containers'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stub = (id: string, path = `/t/${id}`, status = 200): StubMapping => ({
  id,
  persistent: false,
  request: { method: 'GET', urlPath: path },
  response: { status, jsonBody: { id } },
})

let handle: WireMockHandle
let wm: WireMockClient

beforeAll(async () => {
  handle = await startWireMock()
  wm = new WireMockClient({ baseUrl: handle.url, user: handle.user, password: handle.password })
})
afterAll(async () => {
  await handle?.stop()
})
beforeEach(async () => {
  const auth = `Basic ${Buffer.from(`${handle.user}:${handle.password}`).toString('base64')}`
  await fetch(`${handle.url}/__admin/mappings`, { method: 'DELETE', headers: { Authorization: auth } })
})

test('importStubs then getStub round-trips and the stub serves traffic', async () => {
  await wm.importStubs([stub(ID1)], { deleteAllNotInImport: false })
  expect((await wm.getStub(ID1))?.request).toEqual({ method: 'GET', urlPath: `/t/${ID1}` })
  expect(await (await fetch(`${handle.url}/t/${ID1}`)).json()).toEqual({ id: ID1 })
})

test('OVERWRITE replaces a stub with the same id', async () => {
  await wm.importStubs([stub(ID1)], { deleteAllNotInImport: false })
  await wm.importStubs([stub(ID1, undefined, 500)], { deleteAllNotInImport: false })
  expect((await wm.getStub(ID1))?.response.status).toBe(500)
  expect(await wm.listStubIds()).toEqual([ID1])
})

test('deleteAllNotInImport:false keeps other stubs', async () => {
  await wm.importStubs([stub(ID1)], { deleteAllNotInImport: false })
  await wm.importStubs([stub(ID2)], { deleteAllNotInImport: false })
  expect((await wm.listStubIds()).sort()).toEqual([ID1, ID2])
})

test('deleteAllNotInImport:true removes other stubs', async () => {
  await wm.importStubs([stub(ID1)], { deleteAllNotInImport: false })
  await wm.importStubs([stub(ID2)], { deleteAllNotInImport: true })
  expect(await wm.listStubIds()).toEqual([ID2])
})

test('invalid stub is a ValidationError', async () => {
  const bad = { id: ID1, request: { method: 'GET', urlPattern: '([' }, response: { status: 200 } } as StubMapping
  await expect(wm.importStubs([bad], { deleteAllNotInImport: false })).rejects.toBeInstanceOf(ValidationError)
})

test('getStub of unknown id is null; deleteStub of unknown id resolves', async () => {
  expect(await wm.getStub(ID1)).toBeNull()
  await expect(wm.deleteStub(ID1)).resolves.toBeUndefined()
})

test('deleteStub removes an existing stub', async () => {
  await wm.importStubs([stub(ID1)], { deleteAllNotInImport: false })
  await wm.deleteStub(ID1)
  expect(await wm.getStub(ID1)).toBeNull()
})

test('listStubIds pages past 1000', async () => {
  for (let c = 0; c < 3; c++) {
    const batch = Array.from({ length: 500 }, (_, i) => stub(uid(c * 500 + i + 1)))
    await wm.importStubs(batch, { deleteAllNotInImport: false })
  }
  const ids = await wm.listStubIds()
  expect(ids.length).toBe(1500)
  expect(new Set(ids).size).toBe(1500)
})

test('version() starts with 3.', async () => {
  expect(await wm.version()).toMatch(/^3\./)
})

test('ping() is true with the right password and false with a wrong one', async () => {
  expect(await wm.ping()).toBe(true)
  const bad = new WireMockClient({ baseUrl: handle.url, user: handle.user, password: 'nope' })
  expect(await bad.ping()).toBe(false)
})
