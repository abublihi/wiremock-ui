import { describe, expect, test } from 'vitest'
import { ValidationError } from '../../../src/server/errors'
import { decodeRelayBody, parseTestRequest, relayHeaders, relayTarget } from '../../../src/server/wiremock/relay'

const BASE = 'http://wm.test:8080'

describe('relayTarget refuses anything but a stub path on WIREMOCK_URL', () => {
  test.each([
    ['absolute URL', 'http://evil.test/x'],
    ['scheme-relative URL', '//evil.test/x'],
    ['no leading slash', 'x/y'],
    ['backslash host trick', '/\\evil.test/x'],
    ['empty', ''],
    ['admin API', '/__admin/mappings'],
    ['admin root', '/__admin'],
    ['admin, other case', '/__ADMIN/mappings'],
    ['admin with matrix param', '/__admin;x=1/mappings'],
    ['dot-dot segment', '/a/../__admin/mappings'],
    ['dot-dot segment at the end', '/a/..'],
    ['single dot segment', '/./__admin'],
    ['encoded dots', '/a/%2e%2e/__admin/mappings'],
    ['mixed encoded dots', '/a/.%2E/x'],
    ['double-encoded dots', '/a/%252e%252e/__admin'],
    ['dot-dot with matrix param', '/a/..;/__admin/mappings'],
    ['encoded slash', '/a%2f..%2f__admin'],
    ['encoded backslash', '/a%5cb'],
    ['encoded admin', '/%5f%5fadmin/mappings'],
    ['CR/LF in the path', '/a\r\nHost: evil.test'],
    ['space in the path', '/a b'],
    ['NUL in the path', '/a\u0000b'],
    ['fragment', '/a#b'],
    ['query in the path', '/a?b=1'],
    ['malformed percent-encoding', '/a%zz'],
  ])('%s', (_label, path) => {
    expect(() => relayTarget(BASE, path)).toThrow(ValidationError)
  })

  test('a normal stub path, with query string or object, stays on WireMock', () => {
    expect(relayTarget(BASE, '/orders/42').href).toBe('http://wm.test:8080/orders/42')
    expect(relayTarget(BASE, '/orders', 'a=1&b=x%20y').href).toBe('http://wm.test:8080/orders?a=1&b=x%20y')
    expect(relayTarget(BASE, '/orders', '?a=1').href).toBe('http://wm.test:8080/orders?a=1')
    expect(relayTarget(BASE, '/orders', { a: '1', b: ['2', '3'], c: 'x y' }).href).toBe('http://wm.test:8080/orders?a=1&b=2&b=3&c=x+y')
    expect(relayTarget(BASE, '/administrator').pathname).toBe('/administrator')
    expect(relayTarget(BASE, '/a/..b/c..').pathname).toBe('/a/..b/c..')
    expect(relayTarget(BASE, '/caf%C3%A9').pathname).toBe('/caf%C3%A9')
    expect(relayTarget(BASE, '/').pathname).toBe('/')
    expect(relayTarget(BASE, '/@evil.test').host).toBe('wm.test:8080')
  })

  test('keeps a path prefix in WIREMOCK_URL and still refuses its admin API', () => {
    expect(relayTarget('http://wm.test/mock/', '/a').href).toBe('http://wm.test/mock/a')
    expect(() => relayTarget('http://wm.test/mock', '/__admin/mappings')).toThrow(ValidationError)
  })

  test('refuses a query that would end the URL or inject lines', () => {
    expect(() => relayTarget(BASE, '/a', 'x=1#frag')).toThrow(ValidationError)
    expect(() => relayTarget(BASE, '/a', 'x=1\r\nHost: evil')).toThrow(ValidationError)
    expect(() => relayTarget(BASE, '/a', 'x=1 2')).toThrow(ValidationError)
  })
})

describe('relayHeaders', () => {
  test('strips Host, Content-Length and hop-by-hop headers, keeps the rest', () => {
    expect(
      relayHeaders({
        Host: 'evil.test',
        'Content-Length': '5',
        Connection: 'keep-alive, X-Drop-Me',
        'Keep-Alive': 'timeout=5',
        'Transfer-Encoding': 'chunked',
        TE: 'trailers',
        Trailer: 'x',
        Upgrade: 'h2c',
        'Proxy-Authorization': 'Basic x',
        'Proxy-Connection': 'keep-alive',
        Expect: '100-continue',
        'X-Drop-Me': '1',
        'X-Keep': 'yes',
        Authorization: 'Bearer user-token',
        'Content-Type': 'application/json',
      }),
    ).toEqual({ 'X-Keep': 'yes', Authorization: 'Bearer user-token', 'Content-Type': 'application/json' })
  })

  test.each([
    ['CR/LF in a value', { 'X-A': 'v\r\nHost: evil' }],
    ['LF in a value', { 'X-A': 'v\nx' }],
    ['NUL in a value', { 'X-A': 'v\u0000' }],
    ['CR/LF in a name', { 'X-A\r\nHost': 'v' }],
    ['space in a name', { 'X A': 'v' }],
    ['colon in a name', { 'X:A': 'v' }],
    ['empty name', { '': 'v' }],
  ])('refuses %s', (_label, headers) => {
    expect(() => relayHeaders(headers)).toThrow(ValidationError)
  })
})

describe('parseTestRequest', () => {
  test('accepts the documented shape', () => {
    expect(parseTestRequest({ method: 'post', path: '/a', headers: { 'X-A': '1' }, body: '{}' })).toEqual({
      method: 'POST', path: '/a', headers: { 'X-A': '1' }, body: '{}',
    })
  })
  test.each([
    ['unknown method', { method: 'TRACE', path: '/a' }, /method/],
    ['CONNECT', { method: 'CONNECT', path: '/a' }, /method/],
    ['missing path', { method: 'GET' }, /path/],
    ['non-string header value', { method: 'GET', path: '/a', headers: { a: 1 } }, /headers/],
    ['a body on GET', { method: 'GET', path: '/a', body: 'x' }, /body/],
    ['a body on HEAD', { method: 'HEAD', path: '/a', body: 'x' }, /body/],
    ['non-string body', { method: 'POST', path: '/a', body: { a: 1 } }, /body/],
  ])('refuses %s', (_label, raw, message) => {
    expect(() => parseTestRequest(raw)).toThrow(message)
  })
  test('refuses a body over 1 MB with 413', () => {
    try {
      parseTestRequest({ method: 'POST', path: '/a', body: 'x'.repeat(1024 * 1024 + 1) })
      expect.unreachable()
    } catch (err) {
      expect((err as { status: number }).status).toBe(413)
    }
  })
})

describe('decodeRelayBody', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)
  test('textual content types come back as text', () => {
    for (const type of ['application/json', 'text/plain; charset=utf-8', 'application/xml', 'text/html', 'application/javascript', 'application/problem+json', 'application/soap+xml']) {
      expect(decodeRelayBody(bytes('{"ok":"é"}'), type, false)).toEqual({ body: '{"ok":"é"}', bodyIsBase64: false })
    }
  })
  test('no content type: text when it is valid UTF-8', () => {
    expect(decodeRelayBody(bytes('pending'), null, false)).toEqual({ body: 'pending', bodyIsBase64: false })
  })
  test('binary content types and invalid UTF-8 come back as base64', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(decodeRelayBody(png, 'image/png', false)).toEqual({ body: Buffer.from(png).toString('base64'), bodyIsBase64: true })
    const bad = new Uint8Array([0xff, 0xfe, 0x41])
    expect(decodeRelayBody(bad, 'application/json', false)).toEqual({ body: Buffer.from(bad).toString('base64'), bodyIsBase64: true })
    expect(decodeRelayBody(bad, null, false).bodyIsBase64).toBe(true)
  })
  test('a multi-byte character cut by truncation does not turn text into base64', () => {
    const cut = bytes('aé').slice(0, 2)
    expect(decodeRelayBody(cut, 'text/plain', true)).toEqual({ body: 'a', bodyIsBase64: false })
  })
})
