import { describe, expect, it } from 'vitest'
import { buildStub } from '@/server/catalog/build'
import type { Endpoint, Integration, KeyLocation } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { emptyForm, fromStub, generatedName, toSimpleInput, type SimpleForm } from '@/ui/lib/editor-sync'

const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }

const endpoint = (over: Partial<Endpoint> = {}): Endpoint => ({
  integration: 'nic',
  key: 'get-citizen-info',
  name: 'Fetch citizen',
  method: 'POST',
  path: '/nic-service/get-citizen-info',
  pathType: 'exact',
  lookup: { location: 'jsonPath', expression: '$.idNo' },
  contentType: 'json',
  exampleResponses: { '200': '{\n  "name": "Sara"\n}', '404': '{\n  "error": "not found"\n}' },
  allowedStatuses: [],
  updatedAt: '',
  updatedBy: '',
  ...over,
})

const form = (e: Endpoint, over: Partial<SimpleForm> = {}): SimpleForm => ({ ...emptyForm(e), ...over })

/** What the server stores: the builder's output plus the id and server metadata. */
function stored(e: Endpoint, f: SimpleForm): StubMapping {
  const built = buildStub(integration, e, toSimpleInput(f))
  return {
    id: 'm-1',
    ...built,
    metadata: {
      wiremockUi: {
        ...(built.metadata!.wiremockUi as object),
        owner: 'sara',
        version: 2,
        updatedAt: '2026-11-19T00:00:00.000Z',
        updatedBy: 'sara',
        source: 'ui',
      },
    },
  } as StubMapping
}

describe('toSimpleInput', () => {
  const e = endpoint()

  it('sends the key value for a key mock and isDefault for a default one', () => {
    expect(toSimpleInput(form(e, { keyValue: ' 1234 ', body: '{}' }))).toEqual({ keyValue: ' 1234 ', status: 200, body: '{}' })
    expect(toSimpleInput(form(e, { isDefault: true, keyValue: '1234', body: '' }))).toEqual({ isDefault: true, status: 200 })
  })

  it('adds delayMs only when slow, and the timeout preset brings its own 30 s', () => {
    expect(toSimpleInput(form(e, { keyValue: '1', slow: true, delaySeconds: 7 })).delayMs).toBe(7000)
    expect(toSimpleInput(form(e, { keyValue: '1', slow: false, delaySeconds: 7 })).delayMs).toBeUndefined()
    expect(toSimpleInput(form(e, { keyValue: '1', preset: 'timeout', status: 504, slow: true, delaySeconds: 7 }))).toMatchObject({
      status: 504,
      delayMs: 30_000,
    })
  })

  it('a fault strips the status and body', () => {
    const input = toSimpleInput(form(e, { keyValue: '1', fault: 'CONNECTION_RESET_BY_PEER', status: 500, body: '{}' }))
    expect(input).toEqual({ keyValue: '1', fault: 'CONNECTION_RESET_BY_PEER' })
  })

  it('sends a name only when one is typed', () => {
    expect(toSimpleInput(form(e, { keyValue: '1', name: '  ' })).name).toBeUndefined()
    expect(toSimpleInput(form(e, { keyValue: '1', name: 'Sara found' })).name).toBe('Sara found')
  })
})

describe('fromStub round-trips the builder output', () => {
  const locations: [KeyLocation, string][] = [
    ['jsonPath', '$.idNo'],
    ['xPath', '//idNo/text()'],
    ['query', 'idNo'],
    ['path', 'idNo'],
    ['header', 'X-Id-No'],
    ['form', 'idNo'],
  ]

  it.each(locations)('key mock with lookup in %s', (location, expression) => {
    const e = endpoint({ lookup: { location, expression }, pathType: location === 'path' ? 'template' : 'exact', path: location === 'path' ? '/citizens/{idNo}' : '/nic-service/get-citizen-info' })
    const f = form(e, { keyValue: '1234567890', body: '{\n  "name": "Sara"\n}' })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it.each(locations)('default mock on an endpoint with lookup in %s', (location, expression) => {
    const e = endpoint({ lookup: { location, expression } })
    const f = form(e, { isDefault: true, preset: 'notFound', status: 404, body: '{\n  "error": "not found"\n}' })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it('default mock on an endpoint without a lookup', () => {
    const e = endpoint({ lookup: undefined })
    const f = form(e, { isDefault: true })
    expect(f.isDefault).toBe(true)
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it.each([
    ['xml', '<citizen><name>Sara</name></citizen>'],
    ['text', 'hello'],
    ['html', '<p>hello</p>'],
    ['json', '{\n  "list": [\n    1,\n    2\n  ]\n}'],
  ] as const)('%s body', (contentType, body) => {
    const e = endpoint({ contentType, exampleResponses: {} })
    const f = form(e, { keyValue: 'k', body })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it('empty body', () => {
    const e = endpoint({ exampleResponses: {} })
    const f = form(e, { keyValue: 'k', body: '' })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it('every preset and a custom status', () => {
    const e = endpoint()
    for (const [preset, status] of [['success', 200], ['notFound', 404], ['validation', 400], ['serverError', 500], ['custom', 201], ['custom', 504]] as const) {
      const f = form(e, { keyValue: 'k', preset, status, body: '' })
      expect(fromStub(stored(e, f), e)).toEqual(f)
    }
  })

  it('timeout preset', () => {
    const e = endpoint()
    const f = form(e, { keyValue: 'k', preset: 'timeout', status: 504, body: '' })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it('slow response', () => {
    const e = endpoint()
    const f = form(e, { keyValue: 'k', slow: true, delaySeconds: 12 })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it.each(['EMPTY_RESPONSE', 'MALFORMED_RESPONSE_CHUNK', 'RANDOM_DATA_THEN_CLOSE', 'CONNECTION_RESET_BY_PEER'] as const)('fault %s', (fault) => {
    const e = endpoint()
    const f = form(e, { keyValue: 'k', fault, body: '' })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it('fault with a slow response', () => {
    const e = endpoint()
    const f = form(e, { isDefault: true, fault: 'EMPTY_RESPONSE', body: '', slow: true, delaySeconds: 3 })
    expect(fromStub(stored(e, f), e)).toEqual(f)
  })

  it('a typed name survives; the generated name comes back empty', () => {
    const e = endpoint()
    expect(fromStub(stored(e, form(e, { keyValue: 'k', name: 'Sara found' })), e)!.name).toBe('Sara found')
    const s = stored(e, form(e, { keyValue: 'k' }))
    expect(s.name).toBe(generatedName(e, form(e, { keyValue: 'k' })))
    expect(fromStub(s, e)!.name).toBe('')
  })

  it('regex and template paths under the integration prefix', () => {
    for (const e of [endpoint({ pathType: 'regex', path: '/nic-service/.*' }), endpoint({ pathType: 'template', path: '/nic-service/{id}' })]) {
      const f = form(e, { keyValue: 'k' })
      expect(fromStub(stored(e, f), e)).toEqual(f)
    }
  })
})

describe('fromStub refuses what Simple mode cannot show', () => {
  const e = endpoint()
  const base = () => stored(e, form(e, { keyValue: 'k' }))
  const cases: [string, (s: StubMapping) => void][] = [
    ['an extra request matcher', (s) => void (s.request.headers = { 'X-Trace': { equalTo: '1' } })],
    ['a second body pattern', (s) => void (s.request.bodyPatterns as unknown[]).push({ matches: '.*' })],
    ['another lookup expression', (s) => void (s.request.bodyPatterns = [{ matchesJsonPath: { expression: '$.other', equalTo: 'k' } }])],
    ['a non-equalTo lookup', (s) => void (s.request.bodyPatterns = [{ matchesJsonPath: { expression: '$.idNo', contains: 'k' } }])],
    ['another method', (s) => void (s.request.method = 'GET')],
    ['another path', (s) => void (s.request.urlPath = '/nic/other')],
    ['an extra response header', (s) => void ((s.response.headers as Record<string, string>)['X-Extra'] = '1')],
    ['another content type', (s) => void ((s.response.headers as Record<string, string>)['Content-Type'] = 'text/plain')],
    ['transformers', (s) => void (s.response.transformers = ['response-template'])],
    ['a string body on a JSON endpoint', (s) => { delete s.response.jsonBody; s.response.body = '{}' }],
    ['a delay that is not whole seconds', (s) => void (s.response.fixedDelayMilliseconds = 1500)],
    ['a delay over 120 s', (s) => void (s.response.fixedDelayMilliseconds = 121_000)],
    ['another priority', (s) => void (s.priority = 1)],
    ['scenario state', (s) => void (s.scenarioName = 'flow')],
    ['other metadata', (s) => void ((s.metadata as Record<string, unknown>).team = 'x')],
    ['another endpoint', (s) => void (s.metadata!.wiremockUi!.endpoint = 'other')],
    ['an unknown fault', (s) => void (s.response = { fault: 'NOPE' })],
  ]
  it.each(cases)('%s', (_, mutate) => {
    const s = base()
    expect(fromStub(s, e)).not.toBeNull()
    mutate(s)
    expect(fromStub(s, e)).toBeNull()
  })

  it('a key mock on an endpoint that has no lookup', () => {
    const s = base()
    expect(fromStub(s, endpoint({ lookup: undefined }))).toBeNull()
  })
})
