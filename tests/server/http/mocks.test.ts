import { afterAll, beforeAll, expect, test } from 'vitest'
import { healthz } from '../../../src/server/http/handlers/health'
import { createMock, deleteMock, duplicateMock, getMock, listMocks, mockHistory, resetMine, restoreMock, updateMock } from '../../../src/server/http/handlers/mocks'
import type { Runtime } from '../../../src/server/runtime'
import { URL_, basic, login, req as baseReq, startTestRuntime } from '../../helpers/http'

let env: Awaited<ReturnType<typeof startTestRuntime>>
let rt: Runtime
const wm = () => env.wm

const auth = { Authorization: basic('ui-admin', 'ui-admin-pass') }
const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = auth) =>
  baseReq(path, method, body, headers)

const input = (path: string, extra: Record<string, unknown> = {}) => ({
  request: { method: 'GET', urlPath: path },
  response: { status: 200, body: 'hi' },
  ...extra,
})

beforeAll(async () => {
  env = await startTestRuntime()
  rt = env.rt
}, 120_000)

afterAll(async () => {
  await env?.stop()
})

test('401 without credentials, 401 with wrong password', async () => {
  const none = await listMocks(rt, req('/api/mocks', 'GET', undefined, {}))
  expect(none.status).toBe(401)
  expect(none.headers.get('www-authenticate')).toBeNull()
  const wrong = await listMocks(rt, req('/api/mocks', 'GET', undefined, { Authorization: basic('ui-admin', 'nope') }))
  expect(wrong.status).toBe(401)
  const wrongUser = await listMocks(rt, req('/api/mocks', 'GET', undefined, { Authorization: basic('other', 'ui-admin-pass') }))
  expect(wrongUser.status).toBe(401)
  const bearer = await listMocks(rt, req('/api/mocks', 'GET', undefined, { Authorization: 'Bearer abc' }))
  expect(bearer.status).toBe(401)
})

test('non-JSON content type on writes is 415 and creates nothing', async () => {
  const before = (await (await listMocks(rt, req('/api/mocks'))).json()).length
  const res = await createMock(rt, req('/api/mocks', 'POST', JSON.stringify(input('/h/csrf')), { ...auth, 'Content-Type': 'text/plain' }))
  expect(res.status).toBe(415)
  expect(await res.json()).toEqual({ error: 'Content-Type must be application/json' })
  const put = await updateMock(rt, req('/api/mocks/x', 'PUT', JSON.stringify({ stub: input('/x'), version: 1 }), { ...auth, 'Content-Type': 'text/plain' }), { id: 'x' })
  expect(put.status).toBe(415)
  expect((await (await listMocks(rt, req('/api/mocks'))).json()).length).toBe(before)
  const charset = await createMock(rt, req('/api/mocks', 'POST', JSON.stringify(input('/h/csrf-ok')), { ...auth, 'Content-Type': 'application/json; charset=utf-8' }))
  expect(charset.status).toBe(201)
})

test('POST then GET then list', async () => {
  const created = await createMock(rt, req('/api/mocks', 'POST', input('/h/one', { metadata: { wiremockUi: { integration: 'billing' } } })))
  expect(created.status).toBe(201)
  const stub = await created.json()
  expect(stub.metadata.wiremockUi).toMatchObject({ version: 1, updatedBy: 'ui-admin', owner: 'ui-admin', integration: 'billing' })

  const got = await getMock(rt, req(`/api/mocks/${stub.id}`), { id: stub.id })
  expect(got.status).toBe(200)
  expect((await got.json()).id).toBe(stub.id)

  const list = await listMocks(rt, req('/api/mocks?integration=billing'))
  expect(list.status).toBe(200)
  expect((await list.json()).map((s: { id: string }) => s.id)).toContain(stub.id)
  const other = await listMocks(rt, req('/api/mocks?integration=nothing-here'))
  expect(await other.json()).toEqual([])
})

test('PUT with stale version is 409 with message "changed by someone else"', async () => {
  const stub = await (await createMock(rt, req('/api/mocks', 'POST', input('/h/two')))).json()
  const ok = await updateMock(rt, req(`/api/mocks/${stub.id}`, 'PUT', { stub: input('/h/two', { response: { status: 201 } }), version: 1 }), { id: stub.id })
  expect(ok.status).toBe(200)
  expect((await ok.json()).metadata.wiremockUi.version).toBe(2)
  const stale = await updateMock(rt, req(`/api/mocks/${stub.id}`, 'PUT', { stub: input('/h/two'), version: 1 }), { id: stub.id })
  expect(stale.status).toBe(409)
  expect(await stale.json()).toEqual({ error: 'changed by someone else' })
  const missing = await updateMock(rt, req('/api/mocks/nope', 'PUT', { stub: input('/h/two'), version: 1 }), { id: 'nope' })
  expect(missing.status).toBe(404)
})

test('DELETE then GET is 404', async () => {
  const stub = await (await createMock(rt, req('/api/mocks', 'POST', input('/h/three')))).json()
  const stale = await deleteMock(rt, req(`/api/mocks/${stub.id}?version=7`, 'DELETE'), { id: stub.id })
  expect(stale.status).toBe(409)
  const del = await deleteMock(rt, req(`/api/mocks/${stub.id}?version=1`, 'DELETE'), { id: stub.id })
  expect(del.status).toBe(204)
  const got = await getMock(rt, req(`/api/mocks/${stub.id}`), { id: stub.id })
  expect(got.status).toBe(404)
  const again = await deleteMock(rt, req(`/api/mocks/${stub.id}`, 'DELETE'), { id: stub.id })
  expect(again.status).toBe(404)
})

test('malformed JSON body is 400, not 500', async () => {
  const res = await createMock(rt, req('/api/mocks', 'POST', '{not json'))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(/JSON/i)
})

test('body validation names the offending field', async () => {
  const cases: Array<[unknown, string]> = [
    [{ response: { status: 200 } }, 'request'],
    [{ request: [], response: { status: 200 } }, 'request'],
    [{ request: { method: 'GET' }, response: null }, 'response'],
    [{ request: {}, response: 'x' }, 'response'],
    [{ request: {}, response: {}, metadata: [] }, 'metadata'],
    [null, 'body'],
  ]
  for (const [body, field] of cases) {
    const res = await createMock(rt, req('/api/mocks', 'POST', body))
    expect(res.status, JSON.stringify(body)).toBe(400)
    expect((await res.json()).error).toContain(field)
  }
  for (const version of [-1, 1.5, '1', undefined]) {
    const res = await updateMock(rt, req('/api/mocks/x', 'PUT', { stub: input('/x'), version }), { id: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('version')
  }
  const noStub = await updateMock(rt, req('/api/mocks/x', 'PUT', { version: 1 }), { id: 'x' })
  expect(noStub.status).toBe(400)
  expect((await noStub.json()).error).toContain('stub')
  for (const v of ['-1', '1.5', 'abc']) {
    const res = await deleteMock(rt, req(`/api/mocks/x?version=${v}`, 'DELETE'), { id: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('version')
  }
})

test('WireMock rejects stub → 400 carrying WireMock reason', async () => {
  const res = await createMock(rt, req('/api/mocks', 'POST', { request: { method: 'GET', urlPath: '/h/bad', bogusField: 1 }, response: { status: 200 } }))
  expect(res.status).toBe(400)
  const { error } = await res.json()
  expect(error).toContain('Unrecognized field')
  expect(error).toContain('bogusField')
  const file = await createMock(rt, req('/api/mocks', 'POST', input('/h/file', { response: { status: 200, bodyFileName: 'x.json' } })))
  expect(file.status).toBe(400)
  expect(await file.json()).toEqual({ error: 'bodyFileName is not supported; put the body inline' })
})


const mockBody = (path: string) => input(path)

async function userSession(username: string) {
  await rt.users.create({ username, password: 'password-1' }, 'ui-admin')
  return login(rt, username, 'password-1')
}

const asSession = (s: { cookie: string; csrf: string }, withCsrf = true) => ({
  Cookie: s.cookie,
  ...(withCsrf ? { 'X-CSRF-Token': s.csrf } : {}),
})

async function seedBaseline(path: string) {
  const stub = {
    id: crypto.randomUUID(),
    persistent: false,
    ...input(path),
    metadata: { wiremockUi: { owner: 'baseline', version: 1, updatedAt: new Date().toISOString(), updatedBy: 'baseline', source: 'seed' } },
  }
  await rt.wiremock.importStubs([stub as never], { deleteAllNotInImport: false })
  await rt.store.save(stub as never, 0)
  return stub.id
}

const served = async (path: string) => (await fetch(`${wm().url}${path}`)).status

test('cookie POST /api/mocks without X-CSRF-Token is 403, with the token 201', async () => {
  const s = await userSession('csrf-tester')
  const denied = await createMock(rt, req('/api/mocks', 'POST', mockBody('/h/csrf1'), asSession(s, false)))
  expect(denied.status).toBe(403)
  expect(await denied.json()).toEqual({ error: 'CSRF token missing or invalid' })
  const ok = await createMock(rt, req('/api/mocks', 'POST', mockBody('/h/csrf1'), asSession(s)))
  expect(ok.status).toBe(201)
})

test("any signed-in user edits and deletes others' and baseline mocks", async () => {
  const owner = await userSession('user-a')
  const other = await userSession('user-b')
  const mine = await (await createMock(rt, req('/api/mocks', 'POST', mockBody('/h/own'), asSession(owner)))).json()
  const baseId = await seedBaseline('/h/base1')

  const put = await updateMock(rt, req(`/api/mocks/${mine.id}`, 'PUT', { stub: input('/h/own', { response: { status: 418 } }), version: 1 }, asSession(other)), { id: mine.id })
  expect(put.status).toBe(200)
  expect(await served('/h/own')).toBe(418)
  const del = await deleteMock(rt, req(`/api/mocks/${mine.id}`, 'DELETE', undefined, asSession(other)), { id: mine.id })
  expect(del.status).toBe(204)
  expect(await served('/h/own')).toBe(404)

  const basePut = await updateMock(rt, req(`/api/mocks/${baseId}`, 'PUT', { stub: input('/h/base1', { response: { status: 418 } }), version: 1 }, asSession(owner)), { id: baseId })
  expect(basePut.status).toBe(200)
  expect(await served('/h/base1')).toBe(418)
  const baseDel = await deleteMock(rt, req(`/api/mocks/${baseId}`, 'DELETE', undefined, asSession(other)), { id: baseId })
  expect(baseDel.status).toBe(204)
  expect(await served('/h/base1')).toBe(404)
})

test('mock create/update/delete write audit entries with actor and target', async () => {
  const s = await userSession('audited')
  const m = await (await createMock(rt, req('/api/mocks', 'POST', mockBody('/h/audit'), asSession(s)))).json()
  await updateMock(rt, req(`/api/mocks/${m.id}`, 'PUT', { stub: input('/h/audit'), version: 1 }, asSession(s)), { id: m.id })
  await deleteMock(rt, req(`/api/mocks/${m.id}`, 'DELETE', undefined, asSession(s)), { id: m.id })
  const entries = (await rt.audit.list({ limit: 500 })).entries.filter((e) => e.target === m.id)
  expect(entries.map((e) => e.action).sort()).toEqual(['mock.create', 'mock.delete', 'mock.update'])
  expect(entries.every((e) => e.actor === 'audited')).toBe(true)
})

test('a body cannot spoof the owner', async () => {
  const s = await userSession('spoofer')
  const body = input('/h/spoof', { metadata: { wiremockUi: { owner: 'baseline', version: 99, updatedBy: 'baseline' } } })
  const created = await (await createMock(rt, req('/api/mocks', 'POST', body, asSession(s)))).json()
  expect(created.metadata.wiremockUi).toMatchObject({ owner: 'spoofer', version: 1, updatedBy: 'spoofer' })
  const upd = await (await updateMock(rt, req(`/api/mocks/${created.id}`, 'PUT', { stub: body, version: 1 }, asSession(s)), { id: created.id })).json()
  expect(upd.metadata.wiremockUi).toMatchObject({ owner: 'spoofer', version: 2 })
})

test('an audit failure after a committed write is logged and the write still succeeds', async () => {
  const s = await userSession('audit-fail')
  const real = rt.audit.record
  rt.audit.record = async () => {
    throw new Error('audit down')
  }
  try {
    const res = await createMock(rt, req('/api/mocks', 'POST', mockBody('/h/auditfail'), asSession(s)))
    expect(res.status).toBe(201)
    expect(await served('/h/auditfail')).toBe(200)
  } finally {
    rt.audit.record = real
  }
})

test('GET /api/mocks: owner=me, status and q filters; bad status is 400', async () => {
  const s = await userSession('filterer')
  const mine = await (await createMock(rt, req('/api/mocks', 'POST', input('/h/f-mine/zebra', { response: { status: 418 } }), asSession(s)))).json()
  await createMock(rt, req('/api/mocks', 'POST', input('/h/f-other')))
  const ids = async (qs: string) => (await (await listMocks(rt, req(`/api/mocks?${qs}`, 'GET', undefined, asSession(s)))).json()).map((x: { id: string }) => x.id)
  expect(await ids('owner=me')).toEqual([mine.id])
  expect(await ids('owner=me&status=418')).toEqual([mine.id])
  expect(await ids('owner=me&status=200')).toEqual([])
  expect(await ids('q=ZEBRA')).toEqual([mine.id])
  expect(await ids('q=%20%20')).toContain(mine.id)
  for (const bad of ['abc', '99', '600', '2.5', '-200']) {
    expect((await listMocks(rt, req(`/api/mocks?status=${bad}`, 'GET', undefined, asSession(s)))).status).toBe(400)
  }
})

test('duplicate, history, restore and reset-mine over HTTP', async () => {
  const s = await userSession('extras')
  const viewer = await userSession('extras-viewer')
  const other = await userSession('extras-other')
  const baseId = await seedBaseline('/h/x-base')

  // duplicate needs no body or content type, but cookie sessions need CSRF
  const noCsrf = await duplicateMock(rt, new Request(`${URL_}/api/mocks/${baseId}/duplicate`, { method: 'POST', headers: { Cookie: s.cookie } }), { id: baseId })
  expect(noCsrf.status).toBe(403)
  const dupRes = await duplicateMock(rt, new Request(`${URL_}/api/mocks/${baseId}/duplicate`, { method: 'POST', headers: asSession(s) }), { id: baseId })
  expect(dupRes.status).toBe(201)
  const dup = await dupRes.json()
  expect(dup.metadata.wiremockUi.owner).toBe('extras')
  expect((await duplicateMock(rt, req(`/api/mocks/${baseId}/duplicate`, 'POST', undefined, asSession(viewer)), { id: baseId })).status).toBe(201)
  expect((await duplicateMock(rt, req('/api/mocks/nope/duplicate', 'POST', undefined, asSession(s)), { id: 'nope' })).status).toBe(404)

  // history + restore
  await updateMock(rt, req(`/api/mocks/${dup.id}`, 'PUT', { stub: input('/h/x-base', { response: { status: 202, body: 'v2' } }), version: 1 }, asSession(s)), { id: dup.id })
  const hist = await (await mockHistory(rt, req(`/api/mocks/${dup.id}/history`, 'GET', undefined, asSession(viewer)), { id: dup.id })).json()
  expect(hist.map((h: { metadata: { wiremockUi: { version: number } } }) => h.metadata.wiremockUi.version)).toEqual([1])
    expect((await restoreMock(rt, req(`/api/mocks/${dup.id}/restore`, 'POST', { version: 1 }, { ...asSession(s), 'Content-Type': 'text/plain' }), { id: dup.id })).status).toBe(415)
  expect((await restoreMock(rt, req(`/api/mocks/${dup.id}/restore`, 'POST', { version: 'x' }, asSession(s)), { id: dup.id })).status).toBe(400)
  expect((await restoreMock(rt, req(`/api/mocks/${dup.id}/restore`, 'POST', { version: 7 }, asSession(s)), { id: dup.id })).status).toBe(404)
  const restored = await restoreMock(rt, req(`/api/mocks/${dup.id}/restore`, 'POST', { version: 1 }, asSession(s)), { id: dup.id })
  expect(restored.status).toBe(200)
  expect((await restored.json()).metadata.wiremockUi.version).toBe(3)

  // reset-mine: no body, no content type
  const before = await (await listMocks(rt, req('/api/mocks?owner=me', 'GET', undefined, asSession(s)))).json()
  expect(before.length).toBeGreaterThan(0)
  const reset = await resetMine(rt, new Request(`${URL_}/api/mocks/reset-mine`, { method: 'POST', headers: asSession(s) }))
  expect(reset.status).toBe(200)
  expect(await reset.json()).toEqual({ deleted: before.length })
  expect(await (await listMocks(rt, req('/api/mocks?owner=me', 'GET', undefined, asSession(s)))).json()).toEqual([])
  expect(await served('/h/x-base')).toBe(200)
})

// Last: stops WireMock.
test('a body id/uuid cannot target another stub (create, update, duplicate, restore)', async () => {
  const s = await userSession('uuid-tester')
  const baseId = await seedBaseline('/h/uuid-base')
  const wmBody = async (id: string) => {
    const res = await fetch(`${wm().url}/__admin/mappings/${id}`, { headers: { Authorization: basic(wm().user, wm().password) } })
    return res.status === 200 ? (await res.json()).request : res.status
  }
  const spoof = { id: baseId, uuid: baseId }
  const created = await createMock(rt, req('/api/mocks', 'POST', { ...mockBody('/h/uuid-mine'), ...spoof }, asSession(s)))
  expect(created.status).toBe(201)
  const mine = await created.json()
  expect(mine.id).not.toBe(baseId)
  expect(mine.uuid).toBeUndefined()
  const uuidOnly = await createMock(rt, req('/api/mocks', 'POST', { ...mockBody('/h/uuid-only'), uuid: baseId }, asSession(s)))
  expect(uuidOnly.status).toBe(201)
  const upd = await updateMock(rt, req(`/api/mocks/${mine.id}`, 'PUT', { stub: { ...input('/h/uuid-mine2'), ...spoof }, version: 1 }, asSession(s)), { id: mine.id })
  expect(upd.status).toBe(200)
  expect((await upd.json()).uuid).toBeUndefined()
  const dup = await duplicateMock(rt, req(`/api/mocks/${mine.id}/duplicate`, 'POST', {}, asSession(s)), { id: mine.id })
  expect(dup.status).toBe(201)
  const restored = await restoreMock(rt, req(`/api/mocks/${mine.id}/restore`, 'POST', { version: 1 }, asSession(s)), { id: mine.id })
  expect(restored.status).toBe(200)

  expect(await wmBody(baseId)).toMatchObject({ urlPath: '/h/uuid-base' })
  expect(await served('/h/uuid-base')).toBe(200)
  expect((await rt.store.get(baseId))?.metadata?.wiremockUi?.owner).toBe('baseline')
  // Store and WireMock agree on the number of stubs, so the sync count check holds.
  expect((await rt.wiremock.listStubIds()).length).toBe((await rt.store.listAll()).length + 1)
})


test('healthz 200 with lastSyncAt set; 503 with wiremock:"error" after WireMock stops', async () => {
  const ok = await healthz(rt, new Request(`${URL_}/healthz`))
  expect(ok.status).toBe(200)
  const body = await ok.json()
  expect(body).toMatchObject({ ui: 'ok', store: 'ok', wiremock: 'ok', lastSyncError: null })
  expect(body.lastSyncError).toBeNull()
  expect(typeof body.lastSyncAt).toBe('string')

  await wm().stop()
  const down = await healthz(rt, new Request(`${URL_}/healthz`))
  expect(down.status).toBe(503)
  expect(await down.json()).toMatchObject({ store: 'ok', wiremock: 'error' })
})
