import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildStub } from '@/server/catalog/build'
import type { Endpoint, Integration, KeyLocation } from '@/server/catalog/types'
import type { LoggedEvent, StubMapping } from '@/server/wiremock/types'
import { buildCurl, curlFromLoggedRequest, curlFromStub, joinUrl, shellQuote } from '@/ui/lib/curl'
import { draftFromEndpoint, draftFromLoggedRequest, draftFromStub, samplePath } from '@/ui/lib/test-request'

/** The argv a POSIX shell hands to `curl` for this command (a shell function prints its arguments NUL-separated). */
function argvOf(command: string): string[] {
  const script = `curl() { for a in "$@"; do printf '%s\\0' "$a"; done; }\n${command}\n`
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' })
  return out.split('\0').slice(0, -1)
}

const PUBLIC = 'http://wiremock.test:8080'

describe('shellQuote', () => {
  it.each([
    ['plain', "'plain'"],
    ["it's", "'it'\\''s'"],
    ['', "''"],
  ])('quotes %j', (input, quoted) => {
    expect(shellQuote(input)).toBe(quoted)
  })

  it.each([
    ['single quotes', `it's 'quoted'`],
    ['double quotes', `say "hi"`],
    ['newlines', 'line 1\nline 2\n'],
    ['dollar signs', '$HOME ${PATH} $(whoami)'],
    ['backticks', '`whoami`'],
    ['backslashes', 'a\\b\\\\c\\n'],
    ['unicode', 'مرحبا — 日本 ✓ 🎉'],
    ['globs and semicolons', '*; rm -rf / & echo | cat > x'],
    ['history bang', 'wow!'],
  ])('survives a POSIX shell: %s', (_name, value) => {
    expect(argvOf(`curl ${shellQuote(value)}`)).toEqual([value])
  })
})

describe('buildCurl', () => {
  it('puts one flag per line with continuations and leaves out -X for a plain GET', () => {
    const cmd = buildCurl({ method: 'GET', url: `${PUBLIC}/pay/1`, headers: [{ name: 'Accept', value: 'application/json' }] })
    expect(cmd).toBe(`curl '${PUBLIC}/pay/1' \\\n  -H 'Accept: application/json'`)
  })

  it('sends a body with --data-raw and names the method', () => {
    const body = `{"name": "O'Brien", "note": "costs $5 \`now\`",\n "line2": "\\"quoted\\""}`
    const cmd = buildCurl({ method: 'POST', url: `${PUBLIC}/x`, headers: [{ name: 'Content-Type', value: 'application/json' }], body })
    expect(cmd.split('\n')[1]).toBe('  -X POST \\')
    expect(argvOf(cmd)).toEqual([`${PUBLIC}/x`, '-X', 'POST', '-H', 'Content-Type: application/json', '--data-raw', body])
  })

  it('names GET when a GET carries a body (curl would switch to POST)', () => {
    expect(argvOf(buildCurl({ method: 'GET', url: `${PUBLIC}/x`, body: 'a' }))).toEqual([`${PUBLIC}/x`, '-X', 'GET', '--data-raw', 'a'])
  })

  it('uses --head for HEAD (curl -X HEAD waits for a body forever)', () => {
    expect(argvOf(buildCurl({ method: 'HEAD', url: `${PUBLIC}/x` }))).toEqual([`${PUBLIC}/x`, '--head'])
  })

  it('sends an empty header value with curl’s `Name;` form', () => {
    expect(argvOf(buildCurl({ method: 'GET', url: `${PUBLIC}/x`, headers: [{ name: 'X-Empty', value: '' }] }))).toEqual([
      `${PUBLIC}/x`,
      '-H',
      'X-Empty;',
    ])
  })

  it('turns off URL globbing when the URL has brackets or braces', () => {
    expect(argvOf(buildCurl({ method: 'GET', url: `${PUBLIC}/x?ids[]=1` }))).toEqual(['--globoff', `${PUBLIC}/x?ids[]=1`])
  })

  it('puts a comment line first that the shell ignores', () => {
    const cmd = buildCurl({ method: 'GET', url: `${PUBLIC}/x`, comment: 'edit the path\nreally' })
    expect(cmd.startsWith('# edit the path really\ncurl ')).toBe(true)
    expect(argvOf(cmd)).toEqual([`${PUBLIC}/x`])
  })
})

describe('joinUrl', () => {
  it('joins the public URL, path and encoded query', () => {
    expect(joinUrl(`${PUBLIC}/`, '/pay/1', [{ name: 'q', value: 'a b&c=d' }, { name: 'ü', value: '1' }])).toBe(
      `${PUBLIC}/pay/1?q=a%20b%26c%3Dd&%C3%BC=1`,
    )
    expect(joinUrl(PUBLIC, '/x', [])).toBe(`${PUBLIC}/x`)
  })
})

// ── Stub → request ───────────────────────────────────────────────────────────

const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
const endpoint = (over: Partial<Endpoint> = {}): Endpoint => ({
  integration: 'nic',
  key: 'citizen',
  name: 'Fetch citizen',
  method: 'POST',
  path: '/citizen',
  pathType: 'exact',
  lookup: { location: 'jsonPath', expression: '$.idNo' },
  contentType: 'json',
  exampleRequest: '{"idNo": "1000000000", "lang": "en"}',
  exampleResponses: {},
  allowedStatuses: [],
  updatedAt: '',
  updatedBy: '',
  ...over,
})
const stubFor = (e: Endpoint, keyValue?: string) =>
  ({ id: 'm-1', ...buildStub(integration, e, keyValue === undefined ? { isDefault: true, status: 200 } : { keyValue, status: 200 }) }) as StubMapping

describe('draftFromStub — key location', () => {
  it('jsonPath: the catalog example with the key set at the path', () => {
    const e = endpoint()
    const { draft } = draftFromStub(stubFor(e, `O'Neil $1`), e)
    expect(draft.method).toBe('POST')
    expect(draft.path).toBe('/nic/citizen')
    expect(JSON.parse(draft.body)).toEqual({ idNo: `O'Neil $1`, lang: 'en' })
    expect(draft.headers).toContainEqual({ name: 'Content-Type', value: 'application/json' })
  })

  it('jsonPath: a nested path is created when the example lacks it, and no example means a fresh object', () => {
    const e = endpoint({ lookup: { location: 'jsonPath', expression: '$.person.id' }, exampleRequest: undefined })
    expect(JSON.parse(draftFromStub(stubFor(e, '7'), e).draft.body)).toEqual({ person: { id: '7' } })
  })

  it('jsonPath: a complex expression keeps the example as it is', () => {
    const e = endpoint({ lookup: { location: 'jsonPath', expression: "$.items[?(@.k == 'x')].id" } })
    expect(draftFromStub(stubFor(e, '7'), e).draft.body).toBe(e.exampleRequest)
  })

  it('xPath: the element text is replaced in the example', () => {
    const e = endpoint({ lookup: { location: 'xPath', expression: '/req/idNo' }, contentType: 'xml', exampleRequest: '<req><idNo>1</idNo><x/></req>' })
    const { draft } = draftFromStub(stubFor(e, '42'), e)
    expect(draft.body).toBe('<req><idNo>42</idNo><x/></req>')
    expect(draft.headers).toContainEqual({ name: 'Content-Type', value: 'application/xml' })
  })

  it('query: the key is a query parameter, no body', () => {
    const e = endpoint({ method: 'GET', lookup: { location: 'query', expression: 'id' }, exampleRequest: undefined })
    const { draft } = draftFromStub(stubFor(e, 'a b'), e)
    expect(draft).toMatchObject({ method: 'GET', path: '/nic/citizen', query: [{ name: 'id', value: 'a b' }], body: '' })
    expect(curlFromStub(stubFor(e, 'a b'), e, PUBLIC)).toBe(`curl '${PUBLIC}/nic/citizen?id=a%20b'`)
  })

  it('header: the key is a request header', () => {
    const e = endpoint({ method: 'GET', lookup: { location: 'header', expression: 'X-Id' }, exampleRequest: undefined })
    expect(draftFromStub(stubFor(e, '9'), e).draft.headers).toEqual([{ name: 'X-Id', value: '9' }])
  })

  it('form: the key is a url-encoded form field', () => {
    const e = endpoint({ lookup: { location: 'form', expression: 'id' }, exampleRequest: undefined })
    const { draft } = draftFromStub(stubFor(e, 'a&b'), e)
    expect(draft.body).toBe('id=a%26b')
    expect(draft.headers).toContainEqual({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' })
  })

  it('path: a template parameter takes the key value', () => {
    const e = endpoint({ method: 'GET', path: '/citizen/{id}', pathType: 'template', lookup: { location: 'path', expression: 'id' }, exampleRequest: undefined })
    expect(draftFromStub(stubFor(e, '12'), e).draft.path).toBe('/nic/citizen/12')
  })

  it('default mock: the example body as it is', () => {
    const e = endpoint()
    expect(draftFromStub(stubFor(e), e).draft.body).toBe(e.exampleRequest)
  })
})

describe('draftFromStub — path type', () => {
  it('template parameters without a value become `example`', () => {
    const e = endpoint({ method: 'GET', path: '/citizen/{id}/cards/{card}', pathType: 'template', lookup: undefined, exampleRequest: undefined })
    expect(draftFromStub(stubFor(e), e).draft.path).toBe('/nic/citizen/example/cards/example')
  })

  it('a regex path becomes a concrete path when a sample matches it', () => {
    const e = endpoint({ method: 'GET', path: '/citizen/[0-9]+/cards', pathType: 'regex', lookup: undefined, exampleRequest: undefined })
    const result = draftFromStub(stubFor(e), e)
    expect(result.draft.path).toBe('/nic/citizen/1/cards')
    expect(result.pathIsPattern).toBe(false)
  })

  it('a regex path no sample can fill stays visible with a warning, and the curl says to edit it', () => {
    const e = endpoint({ method: 'GET', path: '/(a|b)/x', pathType: 'regex', lookup: undefined, exampleRequest: undefined })
    const result = draftFromStub(stubFor(e), e)
    expect(result.pathIsPattern).toBe(true)
    expect(result.draft.path).toBe('\\/nic/(a|b)/x') // the builder escapes the prefix
    const cmd = curlFromStub(stubFor(e), e, PUBLIC)
    expect(cmd.split('\n')[0]).toBe('# edit the path: this mock matches the pattern \\/nic/(a|b)/x')
  })

  it('url (exact, with query) is split into path and query; ANY becomes GET', () => {
    const stub: StubMapping = { id: 's', request: { method: 'ANY', url: '/a/b?x=1&y=two%20words' }, response: { status: 200 } }
    expect(draftFromStub(stub).draft).toMatchObject({ method: 'GET', path: '/a/b', query: [{ name: 'x', value: '1' }, { name: 'y', value: 'two words' }] })
  })

  it('reads equalToJson bodies, cookies and basic auth from a hand-written stub', () => {
    const stub: StubMapping = {
      id: 's',
      request: {
        method: 'PUT',
        urlPath: '/u',
        bodyPatterns: [{ equalToJson: { a: 1 } }],
        cookies: { session: { equalTo: 'abc' } },
        basicAuthCredentials: { username: 'u', password: 'p' },
        headers: { 'Content-Type': { contains: 'json' }, 'X-Gone': { absent: true } },
      },
      response: { status: 200 },
    }
    const { draft } = draftFromStub(stub)
    expect(JSON.parse(draft.body)).toEqual({ a: 1 })
    expect(draft.headers).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Cookie', value: 'session=abc' },
      { name: 'Authorization', value: `Basic ${btoa('u:p')}` },
    ])
  })
})

describe('samplePath', () => {
  it.each([
    ['/a/\\d+', '/a/1'],
    ['/a/[^/]+/b', '/a/example/b'],
    ['/a/.*', '/a/example'],
    ['/v1/items/[a-z0-9-]+', '/v1/items/example'],
    ['^/a\\.json$', '/a.json'],
  ])('%s → %s', (pattern, sample) => {
    expect(samplePath(pattern)).toBe(sample)
  })
  it('gives up on alternation', () => {
    expect(samplePath('/(x|y)')).toBeNull()
  })
})

describe('curl from a stub runs in a shell as the request it describes', () => {
  const key = `it's "$HOME"`
  const encoded = `it's%20%22%24HOME%22`
  it.each<[KeyLocation, string[]]>([
    ['jsonPath', [`${PUBLIC}/nic/citizen`, '-X', 'POST', '-H', 'Content-Type: application/json', '--data-raw', JSON.stringify({ idNo: key, lang: 'en' }, null, 2)]],
    ['query', [`${PUBLIC}/nic/citizen?id=${encoded}`, '-X', 'POST', '-H', 'Content-Type: application/json', '--data-raw', '{"idNo": "1000000000", "lang": "en"}']],
    ['header', [`${PUBLIC}/nic/citizen`, '-X', 'POST', '-H', `id: ${key}`, '-H', 'Content-Type: application/json', '--data-raw', '{"idNo": "1000000000", "lang": "en"}']],
    ['form', [`${PUBLIC}/nic/citizen`, '-X', 'POST', '-H', 'Content-Type: application/x-www-form-urlencoded', '--data-raw', `id=${encoded}`]],
  ])('%s', (location, argv) => {
    const e = endpoint({ lookup: { location, expression: location === 'jsonPath' ? '$.idNo' : 'id' } })
    expect(argvOf(curlFromStub(stubFor(e, key), e, PUBLIC))).toEqual(argv)
  })
})

// ── Logged request → request ─────────────────────────────────────────────────

const logged = (over: Partial<LoggedEvent['request']> = {}): LoggedEvent => ({
  id: 'e1',
  wasMatched: false,
  request: {
    url: '/pay/1?ids[]=1&q=a+b',
    method: 'POST',
    headers: { Host: 'localhost:8080', 'Content-Type': 'application/json', 'Content-Length': '12', Accept: ['a/b', 'c/d'] },
    body: `{"x":"it's $x"}`,
    ...over,
  },
})

describe('logged requests', () => {
  it('curl repeats the exact request: raw URL, headers (not Host or Content-Length), body', () => {
    const argv = argvOf(curlFromLoggedRequest(logged(), PUBLIC))
    expect(argv).toEqual([
      '--globoff',
      `${PUBLIC}/pay/1?ids[]=1&q=a+b`,
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '-H',
      'Accept: a/b',
      '-H',
      'Accept: c/d',
      '--data-raw',
      `{"x":"it's $x"}`,
    ])
  })

  it('becomes an editable draft', () => {
    expect(draftFromLoggedRequest(logged())).toEqual({
      method: 'POST',
      path: '/pay/1',
      query: [
        { name: 'ids[]', value: '1' },
        { name: 'q', value: 'a b' },
      ],
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Accept', value: 'a/b' },
        { name: 'Accept', value: 'c/d' },
      ],
      body: `{"x":"it's $x"}`,
    })
  })
})

describe('draftFromEndpoint (Try it)', () => {
  const nic = { prefix: '/nic' }
  const base = { method: 'POST', path: '/citizens/fetch', pathType: 'exact' as const, contentType: 'json' as const }

  it('sends the example request to the prefixed path with the catalog content type', () => {
    const { draft, pathIsPattern } = draftFromEndpoint(nic, { ...base, lookup: { location: 'jsonPath', expression: '$.idNo' }, exampleRequest: '{"idNo":"1012345678"}' })
    expect(pathIsPattern).toBe(false)
    expect(draft).toEqual({
      method: 'POST',
      path: '/nic/citizens/fetch',
      query: [],
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: '{"idNo":"1012345678"}',
    })
  })

  it('fills template variables and regex pieces, and treats ANY as GET', () => {
    expect(draftFromEndpoint(nic, { ...base, method: 'ANY', path: '/citizens/{id}', pathType: 'template' }).draft).toMatchObject({ method: 'GET', path: '/nic/citizens/example', body: '' })
    expect(draftFromEndpoint({ prefix: '/' }, { ...base, path: '/citizens/[0-9]+', pathType: 'regex' }).draft.path).toBe('/citizens/1')
    expect(draftFromEndpoint(nic, { ...base, path: '/(a|b)', pathType: 'regex' }).pathIsPattern).toBe(true)
  })

  it('puts a query or header key where the endpoint looks for it', () => {
    expect(draftFromEndpoint(nic, { ...base, method: 'GET', lookup: { location: 'query', expression: 'id' } }).draft.query).toEqual([{ name: 'id', value: 'example' }])
    expect(draftFromEndpoint(nic, { ...base, method: 'GET', lookup: { location: 'header', expression: 'X-Account-Id' } }).draft.headers).toEqual([{ name: 'X-Account-Id', value: 'example' }])
    const form = draftFromEndpoint(nic, { ...base, lookup: { location: 'form', expression: 'accountId' } }).draft
    expect(form.body).toBe('accountId=example')
    expect(form.headers).toEqual([{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }])
  })

  it('keeps an XML example typed as XML', () => {
    const { draft } = draftFromEndpoint(nic, { ...base, contentType: 'xml', exampleRequest: '<id>1</id>' })
    expect(draft.headers).toEqual([{ name: 'Content-Type', value: 'application/xml' }])
  })
})
