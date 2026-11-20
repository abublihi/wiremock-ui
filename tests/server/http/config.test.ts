import { afterAll, beforeAll, expect, test } from 'vitest'
import { getConfig } from '../../../src/server/http/handlers/config'
import type { Runtime } from '../../../src/server/runtime'
import { TEST_DRIVER, basic, login, req, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
}, 120_000)

afterAll(async () => {
  await env?.stop()
})

test('GET /api/config tells a signed-in user which store driver runs and where clients reach WireMock; signed out is 401', async () => {
  expect((await getConfig(rt, req('/api/config', 'GET', undefined, {}))).status).toBe(401)
  const s = await login(rt, 'ui-admin', 'ui-admin-pass')
  const res = await getConfig(rt, req('/api/config', 'GET', undefined, { Cookie: s.cookie }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ storeDriver: TEST_DRIVER, wiremockPublicUrl: env.wm.url })
  const viaBasic = await getConfig(rt, req('/api/config', 'GET', undefined, { Authorization: basic('ui-admin', 'ui-admin-pass') }))
  expect(await viaBasic.json()).toEqual({ storeDriver: TEST_DRIVER, wiremockPublicUrl: env.wm.url })
})
