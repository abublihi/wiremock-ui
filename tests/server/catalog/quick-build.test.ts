import { describe, expect, test } from 'vitest'
import { buildQuickStub, quickMockSchema, type QuickMockInput } from '../../../src/server/catalog/build'
import { AppError } from '../../../src/server/errors'

const input = (extra: Partial<QuickMockInput> = {}, request: Partial<QuickMockInput['request']> = {}): QuickMockInput => ({
  request: { method: 'GET', urlType: 'path', url: '/health', ...request },
  status: 200,
  ...extra,
})
const failure = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    return { status: (err as AppError).status, message: (err as AppError).message }
  }
  throw new Error('did not throw')
}

describe('quick URL mocks: request', () => {
  test('a plain path → method + urlPath, a generated name, no priority and no catalog link', () => {
    const stub = buildQuickStub(input())
    expect(stub).toEqual({ name: 'GET /health', request: { method: 'GET', urlPath: '/health' }, response: { status: 200 } })
  })
  test('template and regex URLs use urlPathTemplate and urlPathPattern', () => {
    expect(buildQuickStub(input({}, { urlType: 'template', url: '/users/{id}' })).request).toEqual({ method: 'GET', urlPathTemplate: '/users/{id}' })
    expect(buildQuickStub(input({}, { urlType: 'regex', url: '/users/[0-9]+' })).request).toEqual({ method: 'GET', urlPathPattern: '/users/[0-9]+' })
  })
  test('query parameters match with equalTo', () => {
    const r = buildQuickStub(input({}, { query: { lang: 'en', page: '2' } })).request
    expect(r.queryParameters).toEqual({ lang: { equalTo: 'en' }, page: { equalTo: '2' } })
  })
  test('a JSON body match is equalToJson ignoring extra fields; any other text is contains', () => {
    expect(buildQuickStub(input({}, { method: 'POST', body: '{"id": 1}' })).request.bodyPatterns).toEqual([
      { equalToJson: '{"id": 1}', ignoreExtraElements: true },
    ])
    expect(buildQuickStub(input({}, { method: 'POST', body: '<id>1</id>' })).request.bodyPatterns).toEqual([{ contains: '<id>1</id>' }])
    expect(buildQuickStub(input({}, { method: 'POST', body: '   ' })).request.bodyPatterns).toBeUndefined()
    expect(buildQuickStub(input({}, { method: 'POST', body: '[1, 2]' })).request.bodyPatterns).toEqual([{ equalToJson: '[1, 2]', ignoreExtraElements: true }])
  })
  test('a JSON scalar (number, true, a quoted string) is plain text to look for, not equalToJson', () => {
    for (const body of ['12345', 'true', '"abc"', 'null']) {
      expect(buildQuickStub(input({}, { method: 'POST', body })).request.bodyPatterns).toEqual([{ contains: body }])
    }
  })
  test('the URL is checked: required, starts with / (not regex), no query string, no spaces', () => {
    expect(failure(() => buildQuickStub(input({}, { url: ' ' }))).message).toBe('request.url is required')
    expect(failure(() => buildQuickStub(input({}, { url: 'health' }))).message).toBe('request.url must start with /')
    expect(failure(() => buildQuickStub(input({}, { url: '/a?b=1' }))).message).toMatch(/^request\.url must not contain a query string/)
    expect(failure(() => buildQuickStub(input({}, { url: '/a b' }))).message).toBe('request.url must not contain spaces')
    expect(buildQuickStub(input({}, { urlType: 'regex', url: '.*/health' })).request.urlPathPattern).toBe('.*/health')
    expect(failure(() => buildQuickStub(input({}, { urlType: 'regex', url: '/users/(' }))).message).toBe('request.url must be a valid regular expression')
    expect(failure(() => buildQuickStub(input({}, { urlType: 'regex', url: '/a[' }))).status).toBe(400)
  })
  test('the schema refuses unknown methods, URL types and fields', () => {
    expect(quickMockSchema.safeParse({ request: { method: 'FETCH', urlType: 'path', url: '/' } }).success).toBe(false)
    expect(quickMockSchema.safeParse({ request: { method: 'GET', urlType: 'glob', url: '/' } }).success).toBe(false)
    expect(quickMockSchema.safeParse({ request: { method: 'GET', urlType: 'path', url: '/' }, keyValue: 'x' }).success).toBe(false)
    expect(quickMockSchema.safeParse({ request: { method: 'GET', urlType: 'path', url: '/', extra: 1 } }).success).toBe(false)
    expect(quickMockSchema.safeParse(input()).success).toBe(true)
  })
})

describe('quick URL mocks: response', () => {
  test('headers as given; a JSON Content-Type turns the body into jsonBody', () => {
    const r = buildQuickStub(input({ headers: { 'Content-Type': 'application/json', 'X-Trace': '1' }, body: '{"ok":true}' })).response
    expect(r).toEqual({ status: 200, headers: { 'Content-Type': 'application/json', 'X-Trace': '1' }, jsonBody: { ok: true } })
  })
  test('a +json type counts as JSON; invalid JSON under a JSON type is refused', () => {
    expect(buildQuickStub(input({ headers: { 'content-type': 'application/problem+json; charset=utf-8' }, body: '[]' })).response.jsonBody).toEqual([])
    expect(failure(() => buildQuickStub(input({ headers: { 'Content-Type': 'application/json' }, body: '{' }))).message).toBe('body is not valid JSON')
  })
  test('any other type (or none) keeps the body as text', () => {
    expect(buildQuickStub(input({ headers: { 'Content-Type': 'text/plain' }, body: '{"a":1}' })).response).toEqual({
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: '{"a":1}',
    })
    expect(buildQuickStub(input({ body: 'pong' })).response).toEqual({ status: 200, body: 'pong' })
  })
  test('a binary body gets application/octet-stream unless a Content-Type is given', () => {
    expect(buildQuickStub(input({ base64Body: 'iVBORw==' })).response).toEqual({
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
      base64Body: 'iVBORw==',
    })
    expect(buildQuickStub(input({ base64Body: 'iVBORw==', headers: { 'Content-Type': 'image/png' } })).response.headers).toEqual({ 'Content-Type': 'image/png' })
    expect(failure(() => buildQuickStub(input({ base64Body: 'iVBORw==', body: 'x' }))).message).toBe('body and base64Body cannot be combined')
  })
  test('delay, fault, proxy, webhook, scenario and name work as for endpoint mocks', () => {
    expect(buildQuickStub(input({ delayMs: 3000 })).response.fixedDelayMilliseconds).toBe(3000)
    expect(buildQuickStub(input({ status: undefined, fault: 'EMPTY_RESPONSE' })).response).toEqual({ fault: 'EMPTY_RESPONSE' })
    expect(buildQuickStub(input({ status: undefined, proxy: { baseUrl: 'https://real.example' } })).response).toEqual({ proxyBaseUrl: 'https://real.example' })
    const stub = buildQuickStub(
      input({ name: 'Health up', webhook: { method: 'POST', url: 'http://hooks.local/cb' }, scenario: { name: 'flow', newState: 'done' } }),
    )
    expect(stub.name).toBe('Health up')
    expect(stub.serveEventListeners).toEqual([{ name: 'webhook', parameters: { method: 'POST', url: 'http://hooks.local/cb' } }])
    expect(stub).toMatchObject({ scenarioName: 'flow', requiredScenarioState: 'Started', newScenarioState: 'done' })
  })
  test('refusals: no status, proxy with fault, empty name, bad proxy URL', () => {
    expect(failure(() => buildQuickStub(input({ status: undefined }))).message).toBe('status is required')
    expect(failure(() => buildQuickStub(input({ fault: 'EMPTY_RESPONSE', proxy: { baseUrl: 'https://x.example' } }))).message).toMatch(/^proxy and fault/)
    expect(failure(() => buildQuickStub(input({ name: '  ' }))).message).toBe('name must not be empty')
    expect(failure(() => buildQuickStub(input({ proxy: { baseUrl: 'ftp://x' } }))).status).toBe(400)
  })
})
