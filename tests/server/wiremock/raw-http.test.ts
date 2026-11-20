import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { rawFetch } from '../../../src/server/wiremock/raw-http'

let seen: IncomingHttpHeaders = {}
const server = createServer((req, res) => {
  seen = req.headers
  req.resume()
  req.on('end', () => res.end('ok'))
})
let base = ''
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

test('a body goes with its Content-Length, not chunked, and only the given headers', async () => {
  const res = await rawFetch(`${base}/x`, { method: 'POST', headers: { 'X-Test': '1' }, body: 'héllo' })
  expect(await res.text()).toBe('ok')
  expect(seen['content-length']).toBe(String(Buffer.byteLength('héllo')))
  expect(seen['transfer-encoding']).toBeUndefined()
  expect(Object.keys(seen).sort()).toEqual(['connection', 'content-length', 'host', 'x-test'])
})

test("the tester's own Content-Length is kept", async () => {
  await rawFetch(`${base}/x`, { method: 'PUT', headers: { 'content-length': '2' }, body: 'ab' })
  expect(seen['content-length']).toBe('2')
  expect(seen['transfer-encoding']).toBeUndefined()
})
