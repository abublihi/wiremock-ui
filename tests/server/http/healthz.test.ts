import { expect, test } from 'vitest'
import { healthz } from '../../../src/server/http/handlers/health'
import type { Runtime } from '../../../src/server/runtime'

const fake = (opts: { ping: () => Promise<boolean>; lastError: string | null; wmPing?: () => Promise<boolean> }) =>
  ({
    store: { ping: opts.ping },
    wiremock: { ping: opts.wmPing ?? (async () => true) },
    reconciler: { lastSyncAt: null, lastError: opts.lastError },
  }) as unknown as Runtime

const call = (rt: Runtime) => healthz(rt, new Request('http://ui.test/healthz'))

test('lastSyncError never leaks internal error text', async () => {
  const res = await call(fake({ ping: async () => true, lastError: 'connect ECONNREFUSED 10.0.0.5:8080 secret' }))
  const body = await res.json()
  expect(body.lastSyncError).toBe('sync failed; see logs')
  expect(JSON.stringify(body)).not.toContain('ECONNREFUSED')
})

test('a hanging store ping yields 503 quickly', async () => {
  const t0 = Date.now()
  const res = await call(fake({ ping: () => new Promise(() => {}), lastError: null }))
  expect(res.status).toBe(503)
  expect((await res.json()).store).toBe('error')
  expect(Date.now() - t0).toBeLessThan(4000)
})

test('healthz returns within 3 s when WireMock hangs', async () => {
  const t0 = Date.now()
  const res = await call(fake({ ping: async () => true, lastError: null, wmPing: () => new Promise(() => {}) }))
  expect(Date.now() - t0).toBeLessThan(3000)
  expect(res.status).toBe(503)
  const body = await res.json()
  expect(body.wiremock).toBe('error')
  expect(body.store).toBe('ok')
})
