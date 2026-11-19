import { expect, test } from 'vitest'
import { UpstreamError } from '../../../src/server/errors'
import { WireMockClient } from '../../../src/server/wiremock/client'

const ID1 = '11111111-1111-4111-8111-111111111111'

test('a hung WireMock call becomes UpstreamError within the timeout', async () => {
  const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal!.reason))
    })) as typeof fetch
  const c = new WireMockClient({ baseUrl: 'http://wm', fetch: hang, timeoutMs: 50, importTimeoutMs: 80 })
  const t0 = Date.now()
  const err = await c.getStub(ID1).catch((e) => e)
  expect(err).toBeInstanceOf(UpstreamError)
  expect(err.message).toBe('WireMock request timed out: GET /__admin/mappings/' + ID1)
  expect(Date.now() - t0).toBeLessThan(1000)
  const imp = await c.importStubs([], { deleteAllNotInImport: false }).catch((e) => e)
  expect(imp.message).toBe('WireMock request timed out: POST /__admin/mappings/import')
})
