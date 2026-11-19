import { afterAll, beforeAll, expect, test } from 'vitest'
import { runImport } from '../../../src/server/http/handlers/imports'
import type { Runtime } from '../../../src/server/runtime'
import type { PublicUser } from '../../../src/server/users/types'
import { basic, req, startTestRuntime } from '../../helpers/http'

// A tester's mock must beat a baseline mock with the same matcher and priority, whatever order they arrived in.
let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
let tester: PublicUser
const BASE_ID = '00000000-0000-4000-8000-0000000b0001'
const matcher = { method: 'GET', urlPath: '/prec/users', queryParameters: { id: { equalTo: '7' } } }
const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const bundle = (body: string) => ({
  mappings: [{ id: BASE_ID, priority: 5, request: matcher, response: { status: 200, body } }],
})
const importBundle = async (body: string) => {
  const res = await runImport(rt, req('/api/import', 'POST', bundle(body), auth))
  expect(res.status).toBe(200)
  return res.json()
}
const answer = async () => (await fetch(`${env.wm.url}/prec/users?id=7`)).text()

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  tester = await rt.users.create({ username: 'prec-tester', role: 'tester', password: 'password-1' }, 'ui-admin')
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

test('tester mock beats a baseline key mock imported after it, after a restart, and after re-import', async () => {
  await rt.mocks.create({ priority: 5, request: matcher, response: { status: 200, body: 'tester' } }, tester)
  expect(await importBundle('baseline')).toMatchObject({ created: 1 })
  expect(await answer()).toBe('tester')

  await env.wm.restart()
  expect(await rt.reconciler.check()).toBe('synced')
  expect(await answer()).toBe('tester')

  expect(await importBundle('baseline')).toMatchObject({ unchanged: 1 })
  expect(await answer()).toBe('tester')
  expect(await importBundle('baseline v2')).toMatchObject({ updated: 1 })
  expect(await answer()).toBe('tester')
  expect(await rt.reconciler.check()).toBe('ok')
})
