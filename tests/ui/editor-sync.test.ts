import { describe, expect, it } from 'vitest'
import { buildStub } from '@/server/catalog/build'
import type { Endpoint, Integration, KeyLocation } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { emptyForm, fromEditable, fromStub, generatedName, parseStubJson, toEditable, toSimpleInput, type SimpleForm } from '@/ui/lib/editor-sync'

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
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it.each(locations)('default mock on an endpoint with lookup in %s', (location, expression) => {
    const e = endpoint({ lookup: { location, expression } })
    const f = form(e, { isDefault: true, preset: 'notFound', status: 404, body: '{\n  "error": "not found"\n}' })
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it('default mock on an endpoint without a lookup', () => {
    const e = endpoint({ lookup: undefined })
    const f = form(e, { isDefault: true })
    expect(f.isDefault).toBe(true)
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it.each([
    ['xml', '<citizen><name>Sara</name></citizen>'],
    ['text', 'hello'],
    ['html', '<p>hello</p>'],
    ['json', '{\n  "list": [\n    1,\n    2\n  ]\n}'],
  ] as const)('%s body', (contentType, body) => {
    const e = endpoint({ contentType, exampleResponses: {} })
    const f = form(e, { keyValue: 'k', body })
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it('empty body', () => {
    const e = endpoint({ exampleResponses: {} })
    const f = form(e, { keyValue: 'k', body: '' })
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it('every preset and a custom status', () => {
    const e = endpoint()
    for (const [preset, status] of [['success', 200], ['notFound', 404], ['validation', 400], ['serverError', 500], ['custom', 201], ['custom', 504]] as const) {
      const f = form(e, { keyValue: 'k', preset, status, body: '' })
      expect(fromStub(stored(e, f), integration, e)).toEqual(f)
    }
  })

  it('timeout preset', () => {
    const e = endpoint()
    const f = form(e, { keyValue: 'k', preset: 'timeout', status: 504, body: '' })
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it('slow response', () => {
    const e = endpoint()
    const f = form(e, { keyValue: 'k', slow: true, delaySeconds: 12 })
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it.each(['EMPTY_RESPONSE', 'MALFORMED_RESPONSE_CHUNK', 'RANDOM_DATA_THEN_CLOSE', 'CONNECTION_RESET_BY_PEER'] as const)('fault %s', (fault) => {
    const e = endpoint()
    const f = form(e, { keyValue: 'k', fault, body: '' })
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it('fault with a slow response', () => {
    const e = endpoint()
    const f = form(e, { isDefault: true, fault: 'EMPTY_RESPONSE', body: '', slow: true, delaySeconds: 3 })
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  it('a typed name survives; the generated name comes back empty', () => {
    const e = endpoint()
    expect(fromStub(stored(e, form(e, { keyValue: 'k', name: 'Sara found' })), integration, e)!.name).toBe('Sara found')
    const s = stored(e, form(e, { keyValue: 'k' }))
    expect(s.name).toBe(generatedName(e, form(e, { keyValue: 'k' })))
    expect(fromStub(s, integration, e)!.name).toBe('')
  })

  it('regex and template paths under the integration prefix', () => {
    for (const e of [endpoint({ pathType: 'regex', path: '/nic-service/.*' }), endpoint({ pathType: 'template', path: '/nic-service/{id}' })]) {
      const f = form(e, { keyValue: 'k' })
      expect(fromStub(stored(e, f), integration, e)).toEqual(f)
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
    ['the path under another prefix', (s) => void (s.request.urlPath = '/other/nic-service/get-citizen-info')],
    ['the path without the prefix', (s) => void (s.request.urlPath = '/nic-service/get-citizen-info')],
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
    expect(fromStub(s, integration, e)).not.toBeNull()
    mutate(s)
    expect(fromStub(s, integration, e)).toBeNull()
  })

  it('a key mock on an endpoint that has no lookup', () => {
    const s = base()
    expect(fromStub(s, integration, endpoint({ lookup: undefined }))).toBeNull()
  })
})

describe('fromStub checks the integration prefix', () => {
  it('a root integration ("/") adds no prefix', () => {
    const root: Integration = { ...integration, prefix: '/' }
    const e = endpoint()
    const f = form(e, { keyValue: 'k' })
    const s = { id: 'm-1', ...buildStub(root, e, toSimpleInput(f)) } as StubMapping
    expect(s.request.urlPath).toBe('/nic-service/get-citizen-info')
    expect(fromStub(s, root, e)).toEqual(f)
    expect(fromStub(s, integration, e)).toBeNull()
  })

  it('a regex path needs the escaped prefix', () => {
    const e = endpoint({ pathType: 'regex', path: '/nic-service/.*' })
    const s = stored(e, form(e, { keyValue: 'k' }))
    expect(s.request.urlPathPattern).toBe('\\/nic/nic-service/.*')
    expect(fromStub(s, integration, e)).not.toBeNull()
    s.request.urlPathPattern = '/nic/nic-service/.*'
    expect(fromStub(s, integration, e)).toBeNull()
  })
})

describe('Advanced JSON helpers', () => {
  const e = endpoint()
  const s = stored(e, form(e, { keyValue: 'k' }))

  it('toEditable drops the id and the server metadata, keeping everything else', () => {
    const withExtra = { ...s, uuid: 'u-1', persistent: false, metadata: { ...s.metadata, team: 'x' } } as StubMapping
    const editable = toEditable(withExtra)
    expect(editable).not.toHaveProperty('id')
    expect(editable).not.toHaveProperty('uuid')
    expect(editable).not.toHaveProperty('persistent')
    expect(editable.metadata).toEqual({ team: 'x' })
    expect(editable.request).toEqual(s.request)
    expect(toEditable(s)).not.toHaveProperty('metadata')
  })

  it('fromEditable puts the catalog link back (and only the link)', () => {
    const editable = { ...toEditable(s), metadata: { wiremockUi: { owner: 'mallory', version: 99 } } }
    expect(fromEditable(editable, { integration: 'nic', endpoint: 'get-citizen-info' }).metadata).toEqual({
      wiremockUi: { integration: 'nic', endpoint: 'get-citizen-info' },
    })
    expect(fromEditable(editable, undefined)).not.toHaveProperty('metadata')
    expect(fromStub({ id: 'm-1', ...fromEditable(toEditable(s), { integration: 'nic', endpoint: 'get-citizen-info' }) } as StubMapping, integration, e)).toEqual(
      fromStub(s, integration, e),
    )
  })

  it('parseStubJson reports the line and column of a syntax error', () => {
    expect(parseStubJson('{"request": {}, "response": {}}')).toEqual({ ok: true, value: { request: {}, response: {} } })
    const bad = parseStubJson('{\n  "request": {},\n  "response": {\n}')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.line).toBe(4)
      expect(bad.column).toBeGreaterThan(0)
      expect(bad.message).not.toMatch(/line \d+|position \d+/)
    }
    const trailing = parseStubJson('{\n  "a": 1,\n}')
    expect(trailing.ok || trailing.line).toBe(3)
  })

  it('parseStubJson gives no position when the engine names none (other than the end)', () => {
    const end = parseStubJson('{\n  "a": ')
    expect(end).toMatchObject({ ok: false, line: 2, column: 8 })
    const odd = parseStubJson('{"a": tru}')
    expect(odd.ok).toBe(false)
  })

  it('parseStubJson wants an object', () => {
    expect(parseStubJson('[]')).toMatchObject({ ok: false, reason: 'notObject' })
    expect(parseStubJson('')).toMatchObject({ ok: false, reason: 'syntax' })
  })
})

describe('proxy and webhook', () => {
  const e = endpoint()
  const proxied = (over: Partial<SimpleForm['proxy']> = {}, f: Partial<SimpleForm> = {}) =>
    form(e, { keyValue: 'k', answer: 'proxy', proxy: { ...emptyForm(e).proxy, baseUrl: 'https://real.example/api', ...over }, ...f })
  const hooked = (over: Partial<SimpleForm['webhook']> = {}, f: Partial<SimpleForm> = {}) =>
    form(e, { keyValue: 'k', webhook: { ...emptyForm(e).webhook, enabled: true, url: 'http://hooks.example/cb', ...over }, ...f })

  it('a new form answers with a mock response and no callback', () => {
    expect(emptyForm(e)).toMatchObject({ answer: 'mock', webhook: { enabled: false, method: 'POST', delay: 'none' } })
    expect(toSimpleInput(form(e, { keyValue: 'k' }))).not.toHaveProperty('proxy')
    expect(toSimpleInput(form(e, { keyValue: 'k' }))).not.toHaveProperty('webhook')
  })

  it('a proxy sends only its fields (and the slow delay), never status, body or fault', () => {
    const f = proxied(
      { stripPrefix: ' /nic ', addHeaders: [{ name: ' X-Env ', value: 'qa' }, { name: '', value: '' }], removeHeaders: 'Authorization, x-secret  Cookie' },
      { slow: true, delaySeconds: 2, fault: 'EMPTY_RESPONSE', preset: 'timeout', status: 504 },
    )
    expect(toSimpleInput(f)).toEqual({
      keyValue: 'k',
      proxy: { baseUrl: 'https://real.example/api', stripPrefix: '/nic', addHeaders: { 'X-Env': 'qa' }, removeHeaders: ['Authorization', 'x-secret', 'Cookie'] },
      delayMs: 2000,
    })
  })

  it('a webhook goes along with any answer; delay none, fixed or random', () => {
    expect(toSimpleInput(hooked()).webhook).toEqual({ method: 'POST', url: 'http://hooks.example/cb' })
    expect(toSimpleInput(hooked({ delay: 'fixed', delayMs: 750 })).webhook!.delay).toEqual({ type: 'fixed', milliseconds: 750 })
    expect(toSimpleInput(hooked({ delay: 'uniform', lower: 100, upper: 900 })).webhook!.delay).toEqual({ type: 'uniform', lower: 100, upper: 900 })
    const both = toSimpleInput(hooked({ headers: [{ name: 'X-Hook', value: '1' }], body: '{"a":1}' }, { answer: 'proxy', proxy: proxied().proxy }))
    expect(both.proxy).toBeDefined()
    expect(both.webhook).toEqual({ method: 'POST', url: 'http://hooks.example/cb', headers: { 'X-Hook': '1' }, body: '{"a":1}' })
  })

  it.each([
    ['base URL only', proxied()],
    ['every proxy field', proxied({ stripPrefix: '/nic', addHeaders: [{ name: 'X-Env', value: 'qa' }, { name: 'X-B', value: '' }], removeHeaders: 'authorization, cookie' })],
    ['a slow proxy', proxied({}, { slow: true, delaySeconds: 5 })],
    ['a webhook', hooked()],
    ['a full webhook', hooked({ method: 'PUT', headers: [{ name: 'Content-Type', value: 'application/json' }], body: `{"id":"{{jsonPath request.body '$.id'}}"}` })],
    ['a fixed webhook delay', hooked({ delay: 'fixed', delayMs: 250 })],
    ['a random webhook delay', hooked({ delay: 'uniform', lower: 0, upper: 600000 })],
    ['a webhook on a fault', hooked({}, { fault: 'EMPTY_RESPONSE', body: '' })],
    ['a webhook on a proxy', hooked({ method: 'DELETE' }, { answer: 'proxy', proxy: proxied().proxy })],
  ])('round-trips %s', (_, f) => {
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  const proxyBase = () => stored(e, proxied())
  const hookBase = () => stored(e, hooked())
  const params = (s: StubMapping) => (s.serveEventListeners as { parameters: Record<string, unknown> }[])[0]!.parameters
  it.each<[string, () => StubMapping, (s: StubMapping) => void]>([
    ['a proxy with a status', proxyBase, (s) => void (s.response.status = 200)],
    ['a proxy with a body', proxyBase, (s) => void (s.response.body = 'x')],
    ['a proxy with another response field', proxyBase, (s) => void (s.response.transformers = ['x'])],
    ['an empty add-headers map', proxyBase, (s) => void (s.response.additionalProxyRequestHeaders = {})],
    ['an empty remove-headers list', proxyBase, (s) => void (s.response.removeProxyRequestHeaders = [])],
    ['a mixed-case remove-header', proxyBase, (s) => void (s.response.removeProxyRequestHeaders = ['X-Secret'])],
    ['a strip prefix without /', proxyBase, (s) => void (s.response.proxyUrlPrefixToRemove = 'nic')],
    ['a non-string base URL', proxyBase, (s) => void (s.response.proxyBaseUrl = 1)],
    ['two listeners', hookBase, (s) => void (s.serveEventListeners as unknown[]).push((s.serveEventListeners as unknown[])[0])],
    ['another listener', hookBase, (s) => void (s.serveEventListeners = [{ name: 'other', parameters: {} }])],
    ['a lognormal delay', hookBase, (s) => void (params(s).delay = { type: 'lognormal', median: 80, sigma: 0.4 })],
    ['a fixed delay with extra keys', hookBase, (s) => void (params(s).delay = { type: 'fixed', milliseconds: 1, x: 1 })],
    ['a method the form does not offer', hookBase, (s) => void (params(s).method = 'PURGE')],
    ['an extra webhook parameter', hookBase, (s) => void (params(s).extensions = {})],
    ['empty webhook headers', hookBase, (s) => void (params(s).headers = {})],
    ['an empty webhook body', hookBase, (s) => void (params(s).body = '')],
    ['an empty listener list', hookBase, (s) => void (s.serveEventListeners = [])],
  ])('refuses %s', (_, base, mutate) => {
    const s = base()
    expect(fromStub(s, integration, e)).not.toBeNull()
    mutate(s)
    expect(fromStub(s, integration, e)).toBeNull()
  })
})

describe('scenario', () => {
  const e = endpoint()
  const staged = (over: Partial<SimpleForm['scenario']> = {}, f: Partial<SimpleForm> = {}) =>
    form(e, { keyValue: 'k', scenario: { ...emptyForm(e).scenario, enabled: true, name: 'loan', ...over }, ...f })

  it('a new form is not stateful; its required state starts at Started', () => {
    expect(emptyForm(e).scenario).toEqual({ enabled: false, name: '', requiredState: 'Started', newState: '' })
    expect(toSimpleInput(form(e, { keyValue: 'k', scenario: { ...emptyForm(e).scenario, name: 'kept but off' } }))).not.toHaveProperty('scenario')
  })

  it('sends the trimmed name and states, leaving out blank ones', () => {
    expect(toSimpleInput(staged({ name: ' loan ', newState: ' approved ' })).scenario).toEqual({ name: 'loan', requiredState: 'Started', newState: 'approved' })
    expect(toSimpleInput(staged({ requiredState: ' ', newState: '' })).scenario).toEqual({ name: 'loan' })
  })

  it.each([
    ['a first step', staged({ newState: 'approved' })],
    ['a last step', staged({ requiredState: 'approved' })],
    ['a step that stays', staged()],
    ['a scenario on a proxy with a webhook', staged({ newState: 'b' }, { answer: 'proxy', proxy: { ...emptyForm(e).proxy, baseUrl: 'https://real.example' }, webhook: { ...emptyForm(e).webhook, enabled: true, url: 'http://h.example/cb' } })],
  ])('round-trips %s', (_, f) => {
    expect(fromStub(stored(e, f), integration, e)).toEqual(f)
  })

  const base = () => stored(e, staged({ newState: 'approved' }))
  it.each<[string, (s: StubMapping) => void]>([
    ['a scenario without a required state (answers in any state)', (s) => void delete s.requiredScenarioState],
    ['a state without a scenario', (s) => void delete s.scenarioName],
    ['a non-string name', (s) => void (s.scenarioName = 1)],
    ['an empty new state', (s) => void (s.newScenarioState = '')],
    ['a padded name', (s) => void (s.scenarioName = ' loan')],
  ])('refuses %s', (_, mutate) => {
    const s = base()
    expect(fromStub(s, integration, e)).not.toBeNull()
    mutate(s)
    expect(fromStub(s, integration, e)).toBeNull()
  })
})

describe('isScenarioNameSettable (kept in step with the server)', () => {
  it('matches the server rule', async () => {
    const { isScenarioNameSettable: server } = await import('@/server/wiremock/client')
    const { isScenarioNameSettable: ui } = await import('@/ui/lib/editor-sync')
    for (const name of ['loan', 'loan-approval_2.x', 'with space', '.hidden', 'a/b', 'a%20b', 'ok:@!', '']) expect(ui(name)).toBe(server(name))
  })
})
