import { describe, expect, it } from 'vitest'
import { buildQuickStub } from '@/server/catalog/build'
import type { StubMapping } from '@/server/wiremock/types'
import {
  type QuickRequest,
  type SimpleForm,
  emptyQuickForm,
  fromQuickStub,
  quickEndpoint,
  toEditable,
  fromEditable,
  toQuickInput,
} from '@/ui/lib/editor-sync'

const quick = (over: Partial<QuickRequest> = {}): QuickRequest => ({ ...emptyQuickForm().quick!, ...over })
const form = (over: Partial<SimpleForm> = {}, request: Partial<QuickRequest> = {}): SimpleForm => ({
  ...emptyQuickForm(),
  ...over,
  quick: quick(request),
})

/** What the server stores for a quick mock: the builder's output plus the id and server metadata (no catalog link). */
function stored(f: SimpleForm): StubMapping {
  return {
    id: 'q-1',
    ...buildQuickStub(toQuickInput(f)),
    metadata: { wiremockUi: { owner: 'sara', version: 1, updatedAt: '', updatedBy: 'sara', source: 'ui' } },
  } as StubMapping
}

describe('quick URL mocks: the form round-trips through the server builder (fromStub → Simple)', () => {
  const cases: [string, SimpleForm][] = [
    ['a fresh form', emptyQuickForm()],
    ['a JSON body under a JSON Content-Type', form({ body: '{\n  "ok": true\n}' }, { url: '/health' })],
    [
      'a template URL with query, a JSON body match and extra headers',
      form(
        { status: 201, preset: 'custom', body: '{\n  "id": 7\n}' },
        {
          method: 'POST',
          urlType: 'template',
          url: '/users/{id}',
          query: [{ name: 'lang', value: 'en' }],
          body: '{"active":true}',
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'X-Trace', value: 'abc' },
          ],
        },
      ),
    ],
    ['a regex URL with a text body match and a text body', form({ body: 'pong' }, { method: 'ANY', urlType: 'regex', url: '/files/[0-9]+', body: 'hello', responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }] })],
    ['a priority (the ANY + regex catch-all)', form({ body: '{\n  "status": "ok"\n}' }, { method: 'ANY', urlType: 'regex', url: '/ajeer-app/api/.*', priority: '10' })],
    ['a JSON scalar body match (plain text to look for)', form({}, { method: 'POST', url: '/pay', body: '12345' })],
    ['no headers and no body', form({ status: 204, preset: 'custom' }, { method: 'DELETE', url: '/items/1', responseHeaders: [] })],
    ['a slow answer with a custom name', form({ slow: true, delaySeconds: 5, name: 'Slow health' })],
    ['the timeout preset', form({ preset: 'timeout', status: 504 })],
    ['a fault', form({ fault: 'CONNECTION_RESET_BY_PEER' })],
    [
      'a binary body with another header',
      form(
        { binary: { base64: 'iVBORw0KGgo=', name: '', size: 8, contentType: 'image/png' } },
        { responseHeaders: [{ name: 'Cache-Control', value: 'no-store' }] },
      ),
    ],
    [
      'a proxy with a delay',
      form({ answer: 'proxy', slow: true, delaySeconds: 2, proxy: { baseUrl: 'https://real.example/api', stripPrefix: '', addHeaders: [], removeHeaders: '' } }),
    ],
    [
      'a webhook and a scenario',
      form({
        webhook: { ...emptyQuickForm().webhook, enabled: true, url: 'http://hooks.local/cb', body: 'done' },
        scenario: { enabled: true, name: 'flow', requiredState: 'Started', newState: 'done' },
      }),
    ],
  ]
  it.each(cases)('%s', (_, f) => {
    expect(fromQuickStub(stored(f))).toEqual(f)
  })

  it('stub → form → stub gives back the same stub', () => {
    for (const [, f] of cases) {
      const stub = stored(f)
      const again = buildQuickStub(toQuickInput(fromQuickStub(stub)!))
      const { id: _id, metadata: _m, ...rest } = stub
      expect(again).toEqual(rest)
    }
  })

  it('reads a stub edited as JSON (Advanced → Simple), without its id or metadata', () => {
    const f = form({ body: '{\n  "ok": true\n}' })
    const edited = fromEditable(toEditable(stored(f)), undefined)
    expect(fromQuickStub({ id: '', ...edited } as StubMapping)).toEqual(f)
  })
})

describe('quick URL mocks: what stays in Advanced', () => {
  const base = () => stored(form({ body: '{\n  "ok": true\n}' }))
  const variants: [string, (s: StubMapping) => StubMapping][] = [
    ['a catalog link', (s) => ({ ...s, metadata: { wiremockUi: { integration: 'nic', endpoint: 'x' } as never } })],
    ['a priority of 0', (s) => ({ ...s, priority: 0 })],
    ['a fractional priority', (s) => ({ ...s, priority: 1.5 })],
    ['a priority given as text', (s) => ({ ...s, priority: '3' as never })],
    ['another request matcher', (s) => ({ ...s, request: { ...s.request, headers: { 'X-A': { equalTo: '1' } } } })],
    ['two URL fields', (s) => ({ ...s, request: { ...s.request, url: '/x' } })],
    ['a non-equalTo query matcher', (s) => ({ ...s, request: { ...s.request, queryParameters: { q: { matches: '.*' } } } })],
    ['equalToJson without ignoreExtraElements', (s) => ({ ...s, request: { ...s.request, bodyPatterns: [{ equalToJson: '{}' }] } })],
    ['a JSON text in contains', (s) => ({ ...s, request: { ...s.request, bodyPatterns: [{ contains: '{}' }] } })],
    ['a text body under a JSON type', (s) => ({ ...s, response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' } })],
    ['a jsonBody under a text type', (s) => ({ ...s, response: { status: 200, headers: { 'Content-Type': 'text/plain' }, jsonBody: {} } })],
    ['transformers', (s) => ({ ...s, response: { ...s.response, transformers: ['response-template'] } })],
    ['an unknown method', (s) => ({ ...s, request: { ...s.request, method: 'TRACE' } })],
    ['equalToJson with a scalar', (s) => ({ ...s, request: { ...s.request, bodyPatterns: [{ equalToJson: '12345', ignoreExtraElements: true }] } })],
    ['a regex the browser cannot parse', (s) => ({ ...s, request: { method: 'GET', urlPathPattern: '/users/(' } })],
    ['a query string in the path', (s) => ({ ...s, request: { method: 'GET', urlPath: '/a?b=1' } })],
  ]
  it.each(variants)('%s', (_, change) => {
    expect(fromQuickStub(change(base()))).toBeNull()
  })

  it('the blank JSON stub reads back (its empty name becomes the generated one)', () => {
    const blank = { id: '', name: '', request: { method: 'GET', urlPath: '/' }, response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: {} } }
    expect(fromQuickStub(blank as StubMapping)).toMatchObject({ name: '', body: '{}', quick: { method: 'GET', url: '/' } })
  })
})

describe('quick URL mocks: priority', () => {
  it('reads the pasted catch-all mock with its priority into Simple mode', () => {
    const stub = {
      id: 'm-1',
      name: 'Mulesoft monitor (any)',
      request: { method: 'ANY', urlPathPattern: '/ajeer-app/api/.*' },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { status: 'ok' } },
      priority: 10,
    } as StubMapping
    const f = fromQuickStub(stub)
    expect(f).toMatchObject({ name: 'Mulesoft monitor (any)', quick: { method: 'ANY', urlType: 'regex', url: '/ajeer-app/api/.*', priority: '10' } })
    expect(buildQuickStub(toQuickInput(f!))).toEqual({ name: stub.name, request: stub.request, response: stub.response, priority: 10 })
  })

  it('an empty priority writes none (WireMock default); spaces around a number are fine', () => {
    expect(toQuickInput(form()).priority).toBeUndefined()
    expect(toQuickInput(form({}, { priority: ' 2 ' })).priority).toBe(2)
    expect('priority' in buildQuickStub(toQuickInput(form()))).toBe(false)
  })
})

describe('quickEndpoint', () => {
  it('derives the body language from the Content-Type row', () => {
    expect(quickEndpoint(quick()).contentType).toBe('json')
    expect(quickEndpoint(quick({ responseHeaders: [{ name: 'content-type', value: 'application/xml' }] })).contentType).toBe('xml')
    expect(quickEndpoint(quick({ responseHeaders: [] })).contentType).toBe('text')
    expect(quickEndpoint(quick({ urlType: 'template', url: '/u/{id}' }))).toMatchObject({ pathType: 'template', path: '/u/{id}', name: 'GET /u/{id}' })
  })
})
