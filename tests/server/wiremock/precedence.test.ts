import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { startWireMock } from '../../helpers/containers'

// Pins the WireMock 3.13.1 tie-break the reconciler relies on for equal-priority stubs.
let wm: Awaited<ReturnType<typeof startWireMock>>
let client: WireMockClient
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const stub = (id: string, body: string) =>
  ({ id, priority: 5, request: { method: 'GET', urlPath: '/tie' }, response: { status: 200, body } }) as StubMapping
const put = (...stubs: StubMapping[]) => client.importStubs(stubs, { deleteAllNotInImport: false })
const winner = async () => (await fetch(`${wm.url}/tie`)).text()

beforeAll(async () => {
  wm = await startWireMock()
  client = new WireMockClient({ baseUrl: wm.url, user: wm.user, password: wm.password })
}, 120_000)
afterAll(async () => {
  await wm?.stop()
})
beforeEach(async () => {
  await wm.restart()
})

test('separate imports: the most recently added stub wins', async () => {
  await put(stub(A, 'A'))
  await put(stub(B, 'B'))
  expect(await winner()).toBe('B')
})

test('an OVERWRITE import of an existing id keeps its old position (changed or not)', async () => {
  await put(stub(A, 'A'))
  await put(stub(B, 'B'))
  await put(stub(A, 'A'))
  expect(await winner()).toBe('B')
  await put(stub(A, 'A2'))
  expect(await winner()).toBe('B')
})

test('within one import call the earlier entry wins', async () => {
  await put(stub(A, 'A'), stub(B, 'B'))
  expect(await winner()).toBe('A')
  await wm.restart()
  await put(stub(B, 'B'), stub(A, 'A'))
  expect(await winner()).toBe('B')
})

test('delete then add moves a stub to the top', async () => {
  await put(stub(A, 'A'))
  await put(stub(B, 'B'))
  await client.deleteStub(A)
  await put(stub(A, 'A'))
  expect(await winner()).toBe('A')
})
