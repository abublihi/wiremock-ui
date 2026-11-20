import { describe, expect, test } from 'vitest'
import { buildStub, escapeRegex, simpleMockSchema, type SimpleMockInput } from '../../../src/server/catalog/build'
import type { Endpoint, Integration } from '../../../src/server/catalog/types'
import { AppError } from '../../../src/server/errors'

const integration = (prefix = '/pay'): Integration => ({
  key: 'pay', name: 'Payments', prefix, updatedAt: '', updatedBy: '',
})
const endpoint = (extra: Partial<Endpoint> = {}): Endpoint => ({
  integration: 'pay', key: 'get-user', name: 'Get user', method: 'POST', path: '/users',
  pathType: 'exact', lookup: { location: 'jsonPath', expression: '$.idNo' }, contentType: 'json',
  exampleResponses: {}, allowedStatuses: [], updatedAt: '', updatedBy: '', ...extra,
})
const input = (extra: Partial<SimpleMockInput> = {}): SimpleMockInput => ({ keyValue: 'k1', status: 200, ...extra })
const build = (e: Partial<Endpoint> = {}, i: Partial<SimpleMockInput> = {}, prefix?: string) =>
  buildStub(integration(prefix), endpoint(e), input(i))
const failure = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    return { status: (err as AppError).status, message: (err as AppError).message }
  }
  throw new Error('did not throw')
}

describe('URL mapping', () => {
  test('exact → urlPath with prefix', () => {
    expect(build().request).toMatchObject({ method: 'POST', urlPath: '/pay/users' })
  })
  test('prefix "/" is not doubled', () => {
    expect(build({}, {}, '/').request.urlPath).toBe('/users')
  })
  test('template → urlPathTemplate', () => {
    const r = build({ pathType: 'template', path: '/users/{id}', lookup: { location: 'path', expression: 'id' } }).request
    expect(r.urlPathTemplate).toBe('/pay/users/{id}')
    expect(r.urlPath).toBeUndefined()
  })
  test('regex → urlPathPattern with escaped prefix and raw path', () => {
    const r = build({ pathType: 'regex', path: '/users/\\d+' }, {}, '/a.b').request
    expect(r.urlPathPattern).toBe('\\/a\\.b/users/\\d+')
  })
  test('regex with prefix "/" has no prefix part', () => {
    expect(build({ pathType: 'regex', path: '/u/.*' }, {}, '/').request.urlPathPattern).toBe('/u/.*')
  })
  test('ANY method passes through', () => {
    expect(build({ method: 'ANY' }).request.method).toBe('ANY')
  })
  test('escapeRegex escapes every special character', () => {
    expect(escapeRegex('\\^$.*+?()[]{}|/')).toBe('\\\\\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/')
  })
})

describe('key matchers', () => {
  const loc = (location: Endpoint['lookup'] & object) => ({ lookup: location })
  test('jsonPath', () => {
    expect(build().request.bodyPatterns).toEqual([{ matchesJsonPath: { expression: '$.idNo', equalTo: 'k1' } }])
  })
  test('xPath', () => {
    expect(build(loc({ location: 'xPath', expression: '/a/b' })).request.bodyPatterns).toEqual([
      { matchesXPath: { expression: '/a/b', equalTo: 'k1' } },
    ])
  })
  test('query', () => {
    expect(build(loc({ location: 'query', expression: 'id' })).request.queryParameters).toEqual({ id: { equalTo: 'k1' } })
  })
  test('path', () => {
    expect(build({ pathType: 'template', path: '/u/{id}', lookup: { location: 'path', expression: 'id' } }).request.pathParameters).toEqual({
      id: { equalTo: 'k1' },
    })
  })
  test('header', () => {
    expect(build(loc({ location: 'header', expression: 'X-Id' })).request.headers).toEqual({ 'X-Id': { equalTo: 'k1' } })
  })
  test('form', () => {
    expect(build(loc({ location: 'form', expression: 'f' })).request.formParameters).toEqual({ f: { equalTo: 'k1' } })
  })
})

describe('priority, name, metadata', () => {
  test('keyed: priority 5 and name with key', () => {
    const s = build()
    expect(s.priority).toBe(5)
    expect(s.name).toBe('Get user — k1')
    expect(s.metadata?.wiremockUi).toEqual({ integration: 'pay', endpoint: 'get-user' })
  })
  test('default: priority 10, no key matcher, default name', () => {
    const s = build({}, { isDefault: true, keyValue: undefined })
    expect(s.priority).toBe(10)
    expect(s.name).toBe('Get user — default')
    expect(s.request.bodyPatterns).toBeUndefined()
  })
  test('explicit name wins', () => {
    expect(build({}, { name: 'Mine' }).name).toBe('Mine')
  })
})

describe('response', () => {
  test.each([
    ['json', 'application/json'],
    ['xml', 'application/xml'],
    ['text', 'text/plain; charset=utf-8'],
    ['html', 'text/html; charset=utf-8'],
  ] as const)('%s default mime', (contentType, mime) => {
    expect(build({ contentType }, { body: 'null' }).response.headers).toEqual({ 'Content-Type': mime })
  })
  test('json body becomes jsonBody', () => {
    const r = build({}, { body: '{"a":1}' }).response
    expect(r.jsonBody).toEqual({ a: 1 })
    expect(r.body).toBeUndefined()
  })
  test('invalid JSON → 400', () => {
    expect(failure(() => build({}, { body: '{nope' }))).toEqual({ status: 400, message: 'body is not valid JSON' })
  })
  test('non-json body stays raw', () => {
    expect(build({ contentType: 'xml' }, { body: '<a/>' }).response.body).toBe('<a/>')
  })
  test('empty or absent body → no body field', () => {
    for (const body of [undefined, '']) {
      const r = build({}, { body }).response
      expect(r.body).toBeUndefined()
      expect(r.jsonBody).toBeUndefined()
    }
  })
  test('custom headers merge; Content-Type override is case-insensitive', () => {
    expect(build({}, { headers: { 'X-A': '1' } }).response.headers).toEqual({ 'Content-Type': 'application/json', 'X-A': '1' })
    expect(build({}, { headers: { 'content-type': 'text/x' } }).response.headers).toEqual({ 'content-type': 'text/x' })
  })
  test('delayMs → fixedDelayMilliseconds', () => {
    expect(build({}, { delayMs: 250 }).response.fixedDelayMilliseconds).toBe(250)
  })
  test('fault → only fault (and delay)', () => {
    expect(build({}, { fault: 'EMPTY_RESPONSE', body: '{}', headers: { a: 'b' } }).response).toEqual({ fault: 'EMPTY_RESPONSE' })
    expect(build({}, { fault: 'CONNECTION_RESET_BY_PEER', delayMs: 5 }).response).toEqual({
      fault: 'CONNECTION_RESET_BY_PEER', fixedDelayMilliseconds: 5,
    })
  })
})

describe('validation', () => {
  test('keyValue required unless default', () => {
    for (const keyValue of [undefined, '']) {
      expect(failure(() => build({}, { keyValue }))).toEqual({ status: 400, message: 'keyValue is required' })
    }
  })
  test('endpoint without lookup only allows default', () => {
    expect(failure(() => build({ lookup: undefined }))).toEqual({
      status: 400, message: 'this endpoint has no lookup; only a default mock can be created',
    })
    expect(build({ lookup: undefined }, { isDefault: true, keyValue: undefined }).priority).toBe(10)
  })
  test('status must be allowed when the list is non-empty', () => {
    expect(failure(() => build({ allowedStatuses: [200, 404] }, { status: 500 }))).toEqual({
      status: 400, message: 'status 500 is not allowed for this endpoint',
    })
    expect(build({ allowedStatuses: [200] }, { status: 200 }).response.status).toBe(200)
  })
})

describe('simpleMockSchema', () => {
  const ok = { status: 200, keyValue: 'a' }
  test('accepts a valid body', () => {
    expect(simpleMockSchema.safeParse({ ...ok, delayMs: 0, headers: { A: 'b' }, fault: 'EMPTY_RESPONSE' }).success).toBe(true)
  })
  test.each([
    ['unknown field', { ...ok, extra: 1 }],
    ['status 99', { ...ok, status: 99 }],
    ['status 600', { ...ok, status: 600 }],
    ['fractional status', { ...ok, status: 200.5 }],
    ['delay too big', { ...ok, delayMs: 120001 }],
    ['negative delay', { ...ok, delayMs: -1 }],
    ['non-string header', { ...ok, headers: { A: 1 } }],
    ['empty header name', { ...ok, headers: { '': 'x' } }],
    ['bad fault', { ...ok, fault: 'NOPE' }],
  ])('rejects %s', (_n, body) => {
    expect(simpleMockSchema.safeParse(body).success).toBe(false)
  })
})

describe('fault mocks, trimming', () => {
  test('status is optional when fault is set, required otherwise', () => {
    expect(simpleMockSchema.safeParse({ keyValue: 'a', fault: 'EMPTY_RESPONSE' }).success).toBe(true)
    expect(build({}, { status: undefined, fault: 'EMPTY_RESPONSE' }).response).toEqual({ fault: 'EMPTY_RESPONSE' })
    expect(failure(() => build({}, { status: undefined }))).toEqual({ status: 400, message: 'status is required' })
  })
  test('allowedStatuses are not enforced for fault mocks', () => {
    expect(build({ allowedStatuses: [200] }, { status: 500, fault: 'EMPTY_RESPONSE' }).response).toEqual({ fault: 'EMPTY_RESPONSE' })
    expect(build({ allowedStatuses: [200] }, { status: undefined, fault: 'CONNECTION_RESET_BY_PEER' }).response.fault).toBe('CONNECTION_RESET_BY_PEER')
  })
  test('keyValue and name are trimmed; empty after trim is 400', () => {
    const s = build({}, { keyValue: '  k9 ', name: '  Mine  ' })
    expect(s.request.bodyPatterns).toEqual([{ matchesJsonPath: { expression: '$.idNo', equalTo: 'k9' } }])
    expect(s.name).toBe('Mine')
    expect(failure(() => build({}, { keyValue: '   ' }))).toEqual({ status: 400, message: 'keyValue is required' })
    expect(failure(() => build({}, { name: ' \t' }))).toEqual({ status: 400, message: 'name must not be empty' })
  })
})

describe('proxy', () => {
  const proxy = (extra: Partial<NonNullable<SimpleMockInput['proxy']>> = {}) => ({ baseUrl: 'https://real.example/api', ...extra })
  test('maps to WireMock proxy fields only: no status, headers or body', () => {
    const r = build({}, { status: undefined, body: '{"a":1}', headers: { 'X-A': '1' }, proxy: proxy() }).response
    expect(r).toEqual({ proxyBaseUrl: 'https://real.example/api' })
  })
  test('every field, remove-headers lower-cased, slow keeps its delay', () => {
    const r = build({}, {
      delayMs: 2000,
      proxy: proxy({ addHeaders: { 'X-Env': 'qa' }, removeHeaders: ['Authorization', 'x-secret'], stripPrefix: '/pay' }),
    }).response
    expect(r).toEqual({
      proxyBaseUrl: 'https://real.example/api',
      additionalProxyRequestHeaders: { 'X-Env': 'qa' },
      removeProxyRequestHeaders: ['authorization', 'x-secret'],
      proxyUrlPrefixToRemove: '/pay',
      fixedDelayMilliseconds: 2000,
    })
  })
  test('empty header map and list are left out', () => {
    expect(build({}, { proxy: proxy({ addHeaders: {}, removeHeaders: [] }) }).response).toEqual({ proxyBaseUrl: 'https://real.example/api' })
  })
  test('status is not required and the allowed list does not apply', () => {
    expect(build({ allowedStatuses: [200] }, { status: undefined, proxy: proxy() }).response.proxyBaseUrl).toBe('https://real.example/api')
  })
  test('validation names the field', () => {
    for (const baseUrl of ['ftp://x', 'real.example', '', 'http://']) {
      expect(failure(() => build({}, { proxy: proxy({ baseUrl }) }))).toEqual({ status: 400, message: 'proxy.baseUrl must be an http:// or https:// URL' })
    }
    expect(failure(() => build({}, { proxy: proxy({ stripPrefix: 'pay' }) }))).toEqual({ status: 400, message: 'proxy.stripPrefix must start with /' })
    expect(failure(() => build({}, { proxy: proxy(), fault: 'EMPTY_RESPONSE' }))).toEqual({
      status: 400, message: 'proxy and fault cannot be combined: a proxied mock answers with the real service\'s response',
    })
  })
  test('schema', () => {
    expect(simpleMockSchema.safeParse({ isDefault: true, proxy: proxy({ addHeaders: { A: 'b' }, removeHeaders: ['c'], stripPrefix: '/x' }) }).success).toBe(true)
    for (const bad of [{ baseUrl: 1 }, { ...proxy(), extra: 1 }, { ...proxy(), removeHeaders: [''] }, { ...proxy(), addHeaders: { A: 1 } }, {}]) {
      expect(simpleMockSchema.safeParse({ isDefault: true, proxy: bad }).success).toBe(false)
    }
  })
})

describe('webhook', () => {
  const hook = (extra: Partial<NonNullable<SimpleMockInput['webhook']>> = {}) => ({ method: 'post', url: 'http://hooks.example/cb', ...extra })
  const listeners = (i: Partial<SimpleMockInput>) => build({}, i).serveEventListeners
  test('maps to one webhook serveEventListener, method upper-cased', () => {
    expect(listeners({ webhook: hook() })).toEqual([{ name: 'webhook', parameters: { method: 'POST', url: 'http://hooks.example/cb' } }])
    expect(build().serveEventListeners).toBeUndefined()
  })
  test('headers, body and each delay', () => {
    const full = hook({ headers: { 'Content-Type': 'application/json' }, body: `{"id":"{{jsonPath request.body '$.id'}}"}`, delay: { type: 'fixed', milliseconds: 500 } })
    expect(listeners({ webhook: full })![0]!.parameters).toEqual({ ...full, method: 'POST' })
    expect(listeners({ webhook: hook({ delay: { type: 'uniform', lower: 100, upper: 900 } }) })![0]!.parameters.delay).toEqual({ type: 'uniform', lower: 100, upper: 900 })
  })
  test('empty headers and body are left out', () => {
    expect(listeners({ webhook: hook({ headers: {}, body: '' }) })![0]!.parameters).toEqual({ method: 'POST', url: 'http://hooks.example/cb' })
  })
  test('combines with a response, a fault or a proxy', () => {
    expect(build({}, { webhook: hook() }).response.status).toBe(200)
    expect(build({}, { fault: 'EMPTY_RESPONSE', webhook: hook() }).serveEventListeners).toHaveLength(1)
    expect(build({}, { proxy: { baseUrl: 'http://x.example' }, webhook: hook() }).serveEventListeners).toHaveLength(1)
  })
  test('a templated URL is allowed', () => {
    expect(listeners({ webhook: hook({ url: 'http://{{request.headers.X-Host}}/cb' }) })).toHaveLength(1)
  })
  test('validation names the field', () => {
    expect(failure(() => build({}, { webhook: hook({ url: 'hooks.example' }) }))).toEqual({ status: 400, message: 'webhook.url must be an http:// or https:// URL' })
    expect(failure(() => build({}, { webhook: hook({ method: 'NO WAY' }) })).message).toMatch(/^webhook\.method must be an HTTP method/)
    expect(failure(() => build({}, { webhook: hook({ delay: { type: 'uniform', lower: 9, upper: 1 } }) })).message).toBe('webhook.delay.lower must not be greater than upper')
    expect(failure(() => build({}, { webhook: hook({ delay: { type: 'fixed', milliseconds: 600_001 } }) })).message).toBe(
      'webhook.delay.milliseconds must be an integer between 0 and 600000',
    )
  })
  test('schema: only fixed and uniform delays', () => {
    expect(simpleMockSchema.safeParse({ isDefault: true, webhook: hook({ delay: { type: 'fixed', milliseconds: 1 } }) }).success).toBe(true)
    for (const bad of [
      { method: 'POST' },
      { ...hook(), extra: 1 },
      { ...hook(), body: 1 },
      { ...hook(), delay: { type: 'lognormal', median: 1, sigma: 1 } },
      { ...hook(), delay: { type: 'fixed', milliseconds: 1, extra: 1 } },
    ]) {
      expect(simpleMockSchema.safeParse({ isDefault: true, webhook: bad }).success).toBe(false)
    }
  })
})
