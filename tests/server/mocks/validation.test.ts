import { describe, expect, test } from 'vitest'
import type { AuditLog } from '../../../src/server/audit/log'
import { ValidationError } from '../../../src/server/errors'
import { MockService, type MockInput } from '../../../src/server/mocks/service'
import type { MockStore } from '../../../src/server/store/types'
import type { PublicUser } from '../../../src/server/users/types'
import type { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'

// Proxy, webhook and scenario field rules run before anything is written, on every write path.

const user: PublicUser = { id: 'u', username: 'u', displayName: 'u', disabled: false, createdAt: '', updatedAt: '' }
const audit: AuditLog = { record: async () => {}, list: async () => ({ entries: [], nextCursor: null }) }

function harness() {
  const imported: StubMapping[][] = []
  const saved = new Map<string, StubMapping>()
  const wiremock = {
    importStubs: async (stubs: StubMapping[]) => void imported.push(stubs),
    deleteStub: async () => {},
  } as unknown as WireMockClient
  const store = {
    get: async (id: string) => saved.get(id) ?? null,
    save: async (stub: StubMapping) => void saved.set(stub.id, stub),
  } as unknown as MockStore
  const svc = new MockService({ wiremock, store, audit, newId: () => 'id-1' })
  return { svc, imported, saved }
}

const proxy = (response: Record<string, unknown>): MockInput => ({ request: { method: 'GET', urlPathPattern: '/p/.*' }, response })
const hook = (parameters: unknown, extra: Record<string, unknown> = {}): MockInput =>
  ({ request: { method: 'POST', urlPath: '/pay' }, response: { status: 202 }, serveEventListeners: [{ name: 'webhook', parameters }], ...extra }) as MockInput
const okHook = { method: 'POST', url: 'https://hooks.test/cb', headers: { 'X-A': '1' }, body: '{"id":"{{request.id}}"}' }

const writePaths = {
  create: (svc: MockService, input: MockInput) => svc.create(input, user),
  update: (svc: MockService, input: MockInput) => svc.update('id-1', input, 1, user),
  import: (svc: MockService, input: MockInput) => svc.upsertImported({ ...input, id: 'id-2' } as StubMapping, 'baseline', 'import', 'u'),
}

const invalid: [string, MockInput, RegExp][] = [
  ['proxyBaseUrl not http(s)', proxy({ proxyBaseUrl: 'ftp://up.test' }), /response\.proxyBaseUrl must be an http:\/\/ or https:\/\/ URL/],
  ['proxyBaseUrl not a URL', proxy({ proxyBaseUrl: 'not a url' }), /response\.proxyBaseUrl/],
  ['proxyBaseUrl not a string', proxy({ proxyBaseUrl: 42 }), /response\.proxyBaseUrl/],
  ['additionalProxyRequestHeaders not a string map', proxy({ proxyBaseUrl: 'http://up.test', additionalProxyRequestHeaders: { a: 1 } }), /response\.additionalProxyRequestHeaders\.a must be a string/],
  ['additionalProxyRequestHeaders an array', proxy({ proxyBaseUrl: 'http://up.test', additionalProxyRequestHeaders: ['a'] }), /response\.additionalProxyRequestHeaders must be an object/],
  ['removeProxyRequestHeaders not a string list', proxy({ proxyBaseUrl: 'http://up.test', removeProxyRequestHeaders: [1] }), /response\.removeProxyRequestHeaders must be a list of header names/],
  ['proxyUrlPrefixToRemove without a leading slash', proxy({ proxyBaseUrl: 'http://up.test', proxyUrlPrefixToRemove: 'api' }), /response\.proxyUrlPrefixToRemove must start with \//],
  ['serveEventListeners not a list', { ...hook(okHook), serveEventListeners: {} } as MockInput, /serveEventListeners must be a list/],
  ['listener without a name', { ...hook(okHook), serveEventListeners: [{ parameters: {} }] } as MockInput, /serveEventListeners\[0\]\.name/],
  ['webhook without parameters', { ...hook(okHook), serveEventListeners: [{ name: 'webhook' }] } as MockInput, /serveEventListeners\[0\]\.parameters must be an object/],
  ['webhook method', hook({ ...okHook, method: 'NOT A METHOD' }), /serveEventListeners\[0\]\.parameters\.method must be an HTTP method such as GET, POST, PUT, PATCH, DELETE/],
  ['webhook method missing', hook({ ...okHook, method: undefined }), /parameters\.method must be an HTTP method/],
  ['webhook url missing', hook({ ...okHook, url: undefined }), /serveEventListeners\[0\]\.parameters\.url must be an http:\/\/ or https:\/\/ URL/],
  ['webhook url scheme', hook({ ...okHook, url: 'file:///etc/passwd' }), /parameters\.url must be an http:\/\/ or https:\/\//],
  ['webhook url not a URL', hook({ ...okHook, url: 'http://' }), /parameters\.url/],
  ['webhook headers', hook({ ...okHook, headers: { a: ['x'] } }), /parameters\.headers\.a must be a string/],
  ['webhook body', hook({ ...okHook, body: { a: 1 } }), /parameters\.body must be a string/],
  ['delay type', hook({ ...okHook, delay: { type: 'gaussian', median: 5 } }), /parameters\.delay must be \{ type: "fixed", milliseconds \}, \{ type: "uniform", lower, upper \} or \{ type: "lognormal", median, sigma \}/],
  ['fixed delay too long', hook({ ...okHook, delay: { type: 'fixed', milliseconds: 600001 } }), /parameters\.delay\.milliseconds must be an integer between 0 and 600000/],
  ['lognormal without sigma', hook({ ...okHook, delay: { type: 'lognormal', median: 5 } }), /parameters\.delay\.sigma must be a number/],
  ['lognormal median too long', hook({ ...okHook, delay: { type: 'lognormal', median: 600001, sigma: 1 } }), /parameters\.delay\.median must be an integer between 0 and 600000/],
  ['fixed delay negative', hook({ ...okHook, delay: { type: 'fixed', milliseconds: -1 } }), /delay\.milliseconds/],
  ['uniform lower above upper', hook({ ...okHook, delay: { type: 'uniform', lower: 50, upper: 10 } }), /parameters\.delay\.lower must not be greater than upper/],
  ['uniform upper too long', hook({ ...okHook, delay: { type: 'uniform', lower: 0, upper: 700000 } }), /parameters\.delay\.upper must be an integer between 0 and 600000/],
  ['proxy prefix without a base URL', proxy({ status: 200, proxyUrlPrefixToRemove: 'api' }), /response\.proxyUrlPrefixToRemove must start with \//],
  ['proxy headers without a base URL', proxy({ status: 200, additionalProxyRequestHeaders: { a: 1 } }), /response\.additionalProxyRequestHeaders\.a must be a string/],
  ['scenarioName empty', { request: { method: 'GET', urlPath: '/s' }, response: { status: 200 }, scenarioName: '' } as MockInput, /scenarioName must be a non-empty string/],
  ['requiredScenarioState without a scenario', { request: { method: 'GET', urlPath: '/s' }, response: { status: 200 }, requiredScenarioState: 'x' } as MockInput, /requiredScenarioState needs scenarioName/],
  ['newScenarioState not a string', { request: { method: 'GET', urlPath: '/s' }, response: { status: 200 }, scenarioName: 's', newScenarioState: 3 } as MockInput, /newScenarioState must be a non-empty string/],
]

describe.each(Object.entries(writePaths))('%s refuses', (_path, write) => {
  test.each(invalid)('%s', async (_label, input, message) => {
    const { svc, imported, saved } = harness()
    saved.set('id-1', { id: 'id-1', request: {}, response: {}, metadata: { wiremockUi: { owner: 'u', version: 1, updatedAt: '', updatedBy: 'u', source: 'ui' } } })
    const err = await write(svc, input).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as Error).message).toMatch(message)
    expect(imported).toEqual([])
  })
})

test('valid proxy, webhook and scenario fields are stored as given (header removal list lower-cased for WireMock)', async () => {
  const { svc, imported } = harness()
  await svc.create(
    proxy({ proxyBaseUrl: 'https://up.test/api', proxyUrlPrefixToRemove: '/p', additionalProxyRequestHeaders: { 'X-A': '1' }, removeProxyRequestHeaders: ['X-Secret', 'cookie'] }),
    user,
  )
  expect(imported[0][0].response).toEqual({
    proxyBaseUrl: 'https://up.test/api',
    proxyUrlPrefixToRemove: '/p',
    additionalProxyRequestHeaders: { 'X-A': '1' },
    removeProxyRequestHeaders: ['x-secret', 'cookie'],
  })
  for (const delay of [undefined, { type: 'fixed', milliseconds: 0 }, { type: 'fixed', milliseconds: 600000 }, { type: 'uniform', lower: 10, upper: 10 }, { type: 'lognormal', median: 90, sigma: 0.1 }, { type: 'lognormal', median: 90, sigma: 0.1, maxValue: 500 }]) {
    const parameters = { ...okHook, url: 'http://{{request.headers.X-Callback-Host}}/cb', delay }
    await svc.create(hook(parameters, { scenarioName: 'flow', requiredScenarioState: 'Started', newScenarioState: 'done' }), user)
    expect(imported.at(-1)![0]).toMatchObject({
      serveEventListeners: [{ name: 'webhook', parameters }],
      scenarioName: 'flow',
      requiredScenarioState: 'Started',
      newScenarioState: 'done',
    })
  }
})

test('listeners other than webhook pass through untouched', async () => {
  const { svc, imported } = harness()
  const other = { name: 'my-extension', parameters: { anything: [1, 2] } }
  await svc.create({ request: { method: 'GET', urlPath: '/x' }, response: { status: 200 }, serveEventListeners: [other] } as MockInput, user)
  expect(imported[0][0].serveEventListeners).toEqual([other])
})

test('re-importing a proxy mock with mixed-case header names is unchanged, not an update', async () => {
  const { svc } = harness()
  const stub = { id: 'id-9', ...proxy({ proxyBaseUrl: 'http://up.test', removeProxyRequestHeaders: ['X-Secret'] }) } as StubMapping
  expect(await svc.upsertImported(stub, 'baseline', 'import', 'u')).toBe('created')
  expect(await svc.upsertImported(stub, 'baseline', 'import', 'u')).toBe('unchanged')
})

test('a webhook method is any method token, stored upper-cased; re-import of the lower-case original is unchanged', async () => {
  const { svc, imported } = harness()
  await svc.create(hook({ ...okHook, method: 'purge' }), user)
  expect((imported[0][0].serveEventListeners as { parameters: { method: string } }[])[0].parameters.method).toBe('PURGE')
  const stub = { id: 'id-8', ...hook({ ...okHook, method: 'post' }) } as StubMapping
  expect(await svc.upsertImported(stub, 'baseline', 'import', 'u')).toBe('created')
  expect(await svc.upsertImported(stub, 'baseline', 'import', 'u')).toBe('unchanged')
})
