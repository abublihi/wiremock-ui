import { afterAll, beforeAll, expect, test } from 'vitest'
import { runImport } from '../../../src/server/http/handlers/imports'
import type { Runtime } from '../../../src/server/runtime'
import { login, req, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
type Session = { cookie: string; csrf: string }
let admin: Session
let tester: Session
const as = (s: Session) => ({ Cookie: s.cookie, 'X-CSRF-Token': s.csrf })

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
  await rt.users.create({ username: 'tess', password: 'password-1' }, 'ui-admin')
  admin = await login(rt, 'ui-admin', 'ui-admin-pass')
  tester = await login(rt, 'tess', 'password-1')
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

const bundle = { mocks: [{ request: { method: 'GET', urlPath: '/http-imp' }, response: { status: 200 } }] }

test('an ordinary user runs imports and gets the report', async () => {
  const res = await runImport(rt, req('/api/import', 'POST', bundle, as(tester)))
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ created: 1, skipped: [], pruned: 0 })
})

test('invalid bundle is 400, non-JSON content type 415, oversized 413', async () => {
  expect((await runImport(rt, req('/api/import', 'POST', { nope: 1 }, as(admin)))).status).toBe(400)
  expect((await runImport(rt, req('/api/import', 'POST', 'x', { ...as(admin), 'Content-Type': 'text/plain' }))).status).toBe(415)
  const big = JSON.stringify({ mocks: [], pad: 'x'.repeat(10 * 1024 * 1024 + 1) })
  expect((await runImport(rt, req('/api/import', 'POST', big, as(admin)))).status).toBe(413)
})

test('?prune=true removes baseline mocks missing from the bundle', async () => {
  const res = await runImport(rt, req('/api/import?prune=true', 'POST', { mocks: [] }, as(admin)))
  expect(await res.json()).toMatchObject({ pruned: 1 })
})
