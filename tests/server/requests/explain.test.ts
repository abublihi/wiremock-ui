import { expect, test } from 'vitest'
import { explainMismatch } from '../../../src/server/requests/explain'
import type { LoggedRequest, StubMapping } from '../../../src/server/wiremock/types'

const stub = (request: Record<string, unknown>): StubMapping => ({ id: 's', request, response: { status: 200 } })
const req = (r: Partial<LoggedRequest> = {}): LoggedRequest => ({ method: 'POST', url: '/x', ...r })
const one = (request: Record<string, unknown>, logged: Partial<LoggedRequest>, field?: string) => {
  const rows = explainMismatch(stub(request), req(logged))
  return field ? rows.find((r) => r.field === field)! : rows[0]
}
const b64 = (s: string) => Buffer.from(s).toString('base64')

test('method', () => {
  expect(one({ method: 'POST' }, {})).toEqual({ field: 'method', expected: 'equalTo POST', actual: 'POST', matched: true })
  expect(one({ method: 'GET' }, {}).matched).toBe(false)
  expect(one({ method: 'ANY' }, {}).matched).toBe(true)
})

test.each([
  [{ url: '/x?a=1' }, '/x?a=1', 'url', 'equalTo /x?a=1', true],
  [{ url: '/y' }, '/x?a=1', 'url', 'equalTo /y', false],
  [{ urlPath: '/x' }, '/x?a=1', 'urlPath', 'equalTo /x', true],
  [{ urlPath: '/y' }, '/x?a=1', 'urlPath', 'equalTo /y', false],
  [{ urlPattern: '/x\\?a=\\d' }, '/x?a=1', 'urlPattern', 'matches /x\\?a=\\d', true],
  [{ urlPattern: '/x' }, '/x?a=1', 'urlPattern', 'matches /x', false],
  [{ urlPathPattern: '/x/.*' }, '/x/1?a=1', 'urlPathPattern', 'matches /x/.*', true],
  [{ urlPathPattern: '/y/.*' }, '/x/1', 'urlPathPattern', 'matches /y/.*', false],
  [{ urlPathTemplate: '/u/{id}' }, '/u/7?z=1', 'urlPathTemplate', 'template /u/{id}', true],
  [{ urlPathTemplate: '/u/{id}' }, '/u/7/extra', 'urlPathTemplate', 'template /u/{id}', false],
  [{ urlPathPattern: '(' }, '/x', 'urlPathPattern', 'matches (', null],
])('url family %j', (stubReq, url, field, expected, matched) => {
  const row = one(stubReq, { url }, field)
  expect(row).toMatchObject({ field, expected, matched })
})

test('string operators', () => {
  const q = (pattern: unknown, value?: string) =>
    one({ queryParameters: { p: pattern } }, { url: value === undefined ? '/x' : `/x?p=${value}` }, 'query.p')
  expect(q({ equalTo: 'Abc' }, 'Abc')).toEqual({ field: 'query.p', expected: 'equalTo Abc', actual: 'Abc', matched: true })
  expect(q({ equalTo: 'Abc' }, 'abc').matched).toBe(false)
  expect(q({ equalTo: 'Abc', caseInsensitive: true }, 'abc').matched).toBe(true)
  expect(q({ contains: 'b' }, 'abc').matched).toBe(true)
  expect(q({ contains: 'z' }, 'abc').matched).toBe(false)
  expect(q({ doesNotContain: 'z' }, 'abc').matched).toBe(true)
  expect(q({ doesNotContain: 'b' }, 'abc').matched).toBe(false)
  expect(q({ matches: '[a-c]+' }, 'abc').matched).toBe(true)
  expect(q({ matches: 'b' }, 'abc').matched).toBe(false)
  expect(q({ doesNotMatch: 'z+' }, 'abc').matched).toBe(true)
  expect(q({ doesNotMatch: '[a-c]+' }, 'abc').matched).toBe(false)
  expect(q({ absent: true }).matched).toBe(true)
  expect(q({ absent: true }, 'abc').matched).toBe(false)
  expect(q({ equalTo: '1' })).toMatchObject({ actual: null, matched: false })
  expect(q({ matches: '(' }, 'abc').matched).toBeNull()
})

test('unsupported operators are not checked', () => {
  expect(one({ queryParameters: { p: { hasExactly: [{ equalTo: 'a' }] } } }, { url: '/x?p=a' })).toEqual({
    field: 'query.p',
    expected: '{"hasExactly":[{"equalTo":"a"}]}',
    actual: 'a',
    matched: null,
  })
  expect(one({ queryParameters: { p: { before: 'now' } } }, {}).matched).toBeNull()
  expect(one({ queryParameters: { p: 'junk' } }, {}).matched).toBeNull()
})

test('query: multi-valued matches if any value matches; queryParams map preferred', () => {
  expect(one({ queryParameters: { p: { equalTo: 'b' } } }, { url: '/x?p=a&p=b' }).matched).toBe(true)
  expect(one({ queryParameters: { p: { equalTo: 'c' } } }, { url: '/x?p=a&p=b' })).toMatchObject({ actual: 'a, b', matched: false })
  const logged = { url: '/x', queryParams: { p: { key: 'p', values: ['z'] } } }
  expect(one({ queryParameters: { p: { equalTo: 'z' } } }, logged).matched).toBe(true)
})

test('headers are case-insensitive', () => {
  const row = one({ headers: { 'X-Key': { equalTo: '1' } } }, { headers: { 'x-key': '1' } })
  expect(row).toEqual({ field: 'header.X-Key', expected: 'equalTo 1', actual: '1', matched: true })
  expect(one({ headers: { 'X-Key': { equalTo: '1' } } }, { headers: { 'X-KEY': '2' } }).matched).toBe(false)
  expect(one({ headers: { 'X-Key': { equalTo: '1' } } }, { headers: { 'X-KEY': ['2', '1'] } }).matched).toBe(true)
  expect(one({ headers: { 'X-Key': { absent: true } } }, { headers: {} }).matched).toBe(true)
  expect(one({ headers: { 'X-Key': { equalTo: '1' } } }, {})).toMatchObject({ actual: null, matched: false })
})

test('cookies from the Cookie header or a cookies map', () => {
  const s = { cookies: { sid: { equalTo: 'abc' } } }
  expect(one(s, { headers: { Cookie: 'a=1; sid=abc' } })).toEqual({ field: 'cookie.sid', expected: 'equalTo abc', actual: 'abc', matched: true })
  expect(one(s, { headers: { Cookie: 'sid=zzz' } }).matched).toBe(false)
  expect(one(s, { cookies: { sid: 'abc' } }).matched).toBe(true)
  expect(one(s, {})).toMatchObject({ actual: null, matched: false })
})

test('path parameters', () => {
  const s = { urlPathTemplate: '/u/{id}/o/{oid}', pathParameters: { id: { equalTo: '7' }, oid: { matches: '\\d+' } } }
  const rows = explainMismatch(stub(s), req({ url: '/u/7/o/abc' }))
  expect(rows.map((r) => r.field)).toEqual(['urlPathTemplate', 'pathParam.id', 'pathParam.oid'])
  expect(rows.map((r) => r.matched)).toEqual([true, true, false])
  expect(rows[2]).toMatchObject({ actual: 'abc', expected: 'matches \\d+' })
  const wrong = explainMismatch(stub(s), req({ url: '/u/7' }))
  expect(wrong[0].matched).toBe(false)
  expect(wrong.slice(1)).toEqual([
    { field: 'pathParam.id', expected: 'equalTo 7', actual: null, matched: false },
    { field: 'pathParam.oid', expected: 'matches \\d+', actual: null, matched: false },
  ])
})

test('form parameters', () => {
  const s = { formParameters: { a: { equalTo: '1' } } }
  const form = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  expect(one(s, { ...form, body: 'a=1&b=2' })).toEqual({ field: 'form.a', expected: 'equalTo 1', actual: '1', matched: true })
  expect(one(s, { ...form, bodyAsBase64: b64('a=2') })).toMatchObject({ actual: '2', matched: false })
  expect(one(s, { body: 'a=1' })).toMatchObject({ actual: null, matched: false })
})

test('basicAuth never echoes the password', () => {
  const s = { basicAuthCredentials: { username: 'u', password: 'p' } }
  const auth = (c: string) => ({ headers: { Authorization: `Basic ${b64(c)}` } })
  expect(one(s, auth('u:p'))).toEqual({ field: 'basicAuth', expected: 'basicAuth u:***', actual: 'u:***', matched: true })
  expect(one(s, auth('u:wrong'))).toMatchObject({ matched: false, actual: 'u:***' })
  expect(one(s, {})).toMatchObject({ matched: false, actual: null })
  expect(one({ basicAuthCredentials: 'x' }, {}).matched).toBeNull()
})

test('body string operators', () => {
  const b = (p: unknown, body?: string) => one({ bodyPatterns: [p] }, { body })
  expect(b({ equalTo: 'hi' }, 'hi')).toEqual({ field: 'body', expected: 'equalTo hi', actual: 'hi', matched: true })
  expect(b({ contains: 'x' }, 'hi')).toMatchObject({ matched: false })
  expect(b({ matches: 'h.' }, 'hi').matched).toBe(true)
  expect(b({ doesNotMatch: 'h.' }, 'hi').matched).toBe(false)
  expect(b({ equalTo: 'hi' }, undefined)).toMatchObject({ actual: null, matched: false })
  expect(b({ binaryEqualTo: 'AA==' }, 'hi').matched).toBeNull()
})

test('body rows come in pattern order', () => {
  const rows = explainMismatch(stub({ bodyPatterns: [{ contains: 'a' }, { contains: 'z' }] }), req({ body: 'abc' }))
  expect(rows.map((r) => [r.expected, r.matched])).toEqual([
    ['contains a', true],
    ['contains z', false],
  ])
})

test('equalToJson', () => {
  const j = (stubJson: unknown, body: string, opts: Record<string, unknown> = {}) =>
    one({ bodyPatterns: [{ equalToJson: stubJson, ...opts }] }, { body })
  expect(j('{"a":1,"b":[1,2]}', '{"b":[1,2],"a":1}').matched).toBe(true)
  expect(j({ a: 1 }, '{"a":2}').matched).toBe(false)
  expect(j({ a: 1 }, '{"a":1,"extra":true}').matched).toBe(false)
  expect(j({ a: 1 }, '{"a":1,"extra":true}', { ignoreExtraElements: true }).matched).toBe(true)
  expect(j({ a: [1, 2] }, '{"a":[2,1]}').matched).toBe(false)
  expect(j({ a: [1, 2] }, '{"a":[2,1]}', { ignoreArrayOrder: true }).matched).toBe(true)
  expect(j({ a: [1, 2] }, '{"a":[1,2,3]}').matched).toBe(false)
  expect(j({ a: [1, 2] }, '{"a":[3,2,1]}', { ignoreArrayOrder: true, ignoreExtraElements: true }).matched).toBe(true)
  expect(j({ a: [1, 2] }, '{"a":[3,1]}', { ignoreArrayOrder: true, ignoreExtraElements: true }).matched).toBe(false)
  expect(j({ a: [1, 2] }, '{"a":[1,9,2]}', { ignoreExtraElements: true }).matched).toBe(true)
  expect(j({ a: [1, 2] }, '{"a":[2,9,1]}', { ignoreExtraElements: true }).matched).toBe(false)
  expect(j({ a: 1 }, 'not json').matched).toBe(false)
  expect(j('not json', '{}').matched).toBeNull()
  expect(j({ a: '${json-unit.any-number}' }, '{"a":1}').matched).toBeNull()
  expect(j({ a: 1 }, '{"a":1}', { ignoreExtraElements: true }).expected).toBe('equalToJson {"a":1} (ignoreExtraElements)')
})

test('matchesJsonPath', () => {
  const jp = (pattern: unknown, body?: string) => one({ bodyPatterns: [{ matchesJsonPath: pattern }] }, { body })
  expect(jp({ expression: '$.idNo', equalTo: '1' }, '{"idNo":"1"}')).toEqual({
    field: 'body',
    expected: 'matchesJsonPath $.idNo equalTo 1',
    actual: '1',
    matched: true,
  })
  expect(jp({ expression: '$.idNo', equalTo: '1' }, '{"idNo":"2"}')).toMatchObject({ actual: '2', matched: false })
  expect(jp({ expression: '$.idNo', equalTo: '1' }, '{"idNo":1}').matched).toBe(true)
  expect(jp({ expression: '$.idNo', equalTo: '1' }, '{"other":1}')).toMatchObject({ actual: null, matched: false })
  expect(jp({ expression: '$.idNo', equalTo: '1' }, 'nope')).toMatchObject({ actual: 'nope', matched: false })
  expect(jp({ expression: '$.idNo', equalTo: '1' }, undefined)).toMatchObject({ actual: null, matched: false })
  expect(jp('$.a.b', '{"a":{"b":0}}')).toMatchObject({ expected: 'matchesJsonPath $.a.b', actual: '0', matched: true })
  expect(jp('$.a.c', '{"a":{"b":0}}').matched).toBe(false)
  expect(jp({ expression: '$.items[?(@.k=="v")]' }, '{"items":[{"k":"v"}]}').matched).toBe(true)
  expect(jp({ expression: '$.a', contains: 'b' }, '{"a":{"x":"b"}}').matched).toBe(true)
  expect(jp({ expression: 5 }, '{}').matched).toBeNull()
  expect(jp({ expression: '$[', equalTo: '1' }, '{}').matched).not.toBe(true)
})

test('matchesXPath is not checked', () => {
  expect(one({ bodyPatterns: [{ matchesXPath: '/a/b' }] }, { body: '<a/>' })).toEqual({
    field: 'body',
    expected: 'matchesXPath /a/b',
    actual: null,
    matched: null,
  })
})

test('rows are ordered and never throw on odd input', () => {
  const rows = explainMismatch(
    stub({
      bodyPatterns: [{ contains: 'a' }],
      formParameters: { f: { equalTo: '1' } },
      basicAuthCredentials: { username: 'u', password: 'p' },
      cookies: { c: { equalTo: '1' } },
      headers: { h: { equalTo: '1' } },
      queryParameters: { q: { equalTo: '1' } },
      pathParameters: { id: { equalTo: '1' } },
      urlPathTemplate: '/u/{id}',
      method: 'GET',
    }),
    req({ url: '/u/1' }),
  )
  expect(rows.map((r) => r.field)).toEqual([
    'method', 'urlPathTemplate', 'pathParam.id', 'query.q', 'header.h', 'cookie.c', 'basicAuth', 'form.f', 'body',
  ])
  expect(() => explainMismatch({ id: 's' } as never, {} as never)).not.toThrow()
  expect(() => explainMismatch(stub({ method: 5, urlPath: {}, queryParameters: [], bodyPatterns: [null, 3, { x: 1 }] }), req())).not.toThrow()
  expect(explainMismatch({ id: 's' } as never, {} as never)).toEqual([])
})
