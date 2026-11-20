import type { QuickMockInput, SimpleMockInput } from '@/server/catalog/build'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import {
  SLOW_MAX_SECONDS,
  SLOW_MIN_SECONDS,
  TIMEOUT_DELAY_MS,
  isFault,
  isWebhookMethod,
  presetForStatus,
  presetToStatus,
  visiblePresets,
  type Fault,
  type Preset,
  type WebhookMethod,
} from './presets'
import { base64Size } from './body-file'

/** A header name and value as the form edits them (rows keep their order). */
export type HeaderRow = { name: string; value: string }

/** Forward to a real service: WireMock's proxyBaseUrl and friends. */
export type ProxyForm = {
  baseUrl: string
  /** Path prefix removed before forwarding ("" keeps the path as it is). */
  stripPrefix: string
  addHeaders: HeaderRow[]
  /** Header names to drop, separated by commas or spaces. */
  removeHeaders: string
}

export type WebhookDelay = 'none' | 'fixed' | 'uniform'

/** Call back after responding: one WireMock webhook serveEventListener. */
export type WebhookForm = {
  enabled: boolean
  method: WebhookMethod
  url: string
  headers: HeaderRow[]
  body: string
  delay: WebhookDelay
  delayMs: number
  lower: number
  upper: number
}

/** Make the mock stateful: answer only in one state of a named scenario, then optionally move it on. */
export type ScenarioForm = {
  enabled: boolean
  name: string
  /** Blank means `Started` (the builder's default). */
  requiredState: string
  /** Blank leaves the scenario where it is. */
  newState: string
}

/** WireMock's first state of every scenario. */
export const STARTED = 'Started'

// Same rule as the server's isScenarioNameSettable (src/server/wiremock/client.ts; not imported: server module).
const SETTABLE_SCENARIO_NAME = /^[A-Za-z0-9\-._~!$&'()*+,=:@]+$/

/** Whether the Scenarios page can set this scenario's state (WireMock 3.13.1 cannot address names with spaces and the like). */
export const isScenarioNameSettable = (name: string) => SETTABLE_SCENARIO_NAME.test(name) && !name.startsWith('.')

/** A response body uploaded from a non-text file: sent as WireMock's base64Body with the file's Content-Type. */
export type BinaryBody = {
  base64: string
  /** The file name when it was just uploaded; '' for a saved mock (WireMock keeps no file name). */
  name: string
  size: number
  contentType: string
}

export type SimpleForm = {
  integration: string
  endpoint: string
  isDefault: boolean
  keyValue: string
  preset: Preset
  status: number
  body: string
  /** Replaces `body` while set. */
  binary: BinaryBody | null
  slow: boolean
  delaySeconds: number
  fault: '' | Fault
  name: string
  /** Answer with the form's response, or forward to a real service. */
  answer: 'mock' | 'proxy'
  proxy: ProxyForm
  webhook: WebhookForm
  scenario: ScenarioForm
  /** Set for a quick mock of a URL ("Mock a URL directly"): its own request instead of a catalog endpoint and key. */
  quick?: QuickRequest
}

/** How a quick mock matches the URL path: exactly, as a template (`/users/{id}`) or as a regular expression. */
export type QuickUrlType = QuickMockInput['request']['urlType']
export type QuickMethod = QuickMockInput['request']['method']

/** The request side of a quick mock, plus its response headers (an endpoint mock takes those from the catalog). */
export type QuickRequest = {
  method: QuickMethod
  urlType: QuickUrlType
  url: string
  /** Query parameters the request must carry (each value matched exactly). */
  query: HeaderRow[]
  /** Request body to match: JSON matches as JSON (extra fields allowed), any other text must be contained. */
  body: string
  responseHeaders: HeaderRow[]
}

export const DEFAULT_SLOW_SECONDS = 3

// Keep in step with the server builder (src/server/catalog/build.ts): what it writes is what we read back.
const MIME: Record<Endpoint['contentType'], string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
}
const PRIORITY = { key: 5, default: 10 } as const

/** The example response for a status, or '' when the catalog has none. */
export const exampleFor = (endpoint: Endpoint, status: number) => endpoint.exampleResponses[String(status)] ?? ''

/** A fresh form for an endpoint: the first allowed preset with its example body. */
export function emptyForm(endpoint: Endpoint): SimpleForm {
  const first = visiblePresets(endpoint.allowedStatuses)[0]
  const status = first ? presetToStatus(first).status : (endpoint.allowedStatuses[0] ?? 200)
  return {
    integration: endpoint.integration,
    endpoint: endpoint.key,
    isDefault: !endpoint.lookup,
    keyValue: '',
    preset: first ?? 'custom',
    status,
    body: exampleFor(endpoint, status),
    binary: null,
    slow: false,
    delaySeconds: DEFAULT_SLOW_SECONDS,
    fault: '',
    name: '',
    answer: 'mock',
    proxy: { baseUrl: '', stripPrefix: '', addHeaders: [], removeHeaders: '' },
    webhook: { enabled: false, method: 'POST', url: '', headers: [], body: '', delay: 'none', delayMs: 1000, lower: 500, upper: 2000 },
    scenario: { enabled: false, name: '', requiredState: STARTED, newState: '' },
  }
}

/** A scenario a new mock starts in ("Add a mock to this scenario" on the Scenarios page). */
export type ScenarioSeed = { name: string; requiredState: string }

/** The form with its Scenario section turned on for `seed` (unchanged without one). */
export function seedScenario(form: SimpleForm, seed: ScenarioSeed | undefined): SimpleForm {
  return seed ? { ...form, scenario: { enabled: true, name: seed.name, requiredState: seed.requiredState, newState: '' } } : form
}

/** Rows with a name, as a header map (names trimmed); undefined when there are none. */
export function headerMap(rows: HeaderRow[]): Record<string, string> | undefined {
  const named = rows.filter((r) => r.name.trim() !== '')
  return named.length > 0 ? Object.fromEntries(named.map((r) => [r.name.trim(), r.value])) : undefined
}

/** An absolute http(s) URL; a templated one ("http://{{…}}/cb") is only checked up to its scheme, as the server does. */
export function isHttpUrl(text: string, opts: { templated?: boolean } = {}): boolean {
  const value = text.trim()
  if (!/^https?:\/\/\S/i.test(value)) return false
  if (opts.templated && value.includes('{{')) return true
  try {
    return new URL(value).host !== ''
  } catch {
    return false
  }
}

/** The header names in the "remove" text. */
export const headerNames = (text: string) => text.split(/[\s,]+/).filter(Boolean)

/** The name the server gives a mock when the form's name is empty. */
export function generatedName(endpoint: Endpoint, form: Pick<SimpleForm, 'isDefault' | 'keyValue'>): string {
  return `${endpoint.name} — ${form.isDefault ? 'default' : form.keyValue.trim()}`
}

/** The body the preview and create endpoints accept. */
export function toSimpleInput(form: SimpleForm): SimpleMockInput {
  const input: SimpleMockInput = form.isDefault ? { isDefault: true } : { keyValue: form.keyValue }
  if (form.answer === 'proxy') {
    // The real service answers: no status, body, fault or timeout preset of ours.
    const { baseUrl, stripPrefix, addHeaders, removeHeaders } = form.proxy
    input.proxy = { baseUrl: baseUrl.trim() }
    if (stripPrefix.trim() !== '') input.proxy.stripPrefix = stripPrefix.trim()
    const add = headerMap(addHeaders)
    if (add) input.proxy.addHeaders = add
    const remove = headerNames(removeHeaders)
    if (remove.length > 0) input.proxy.removeHeaders = remove
    if (form.slow) input.delayMs = Math.round(form.delaySeconds * 1000)
  } else if (form.fault) input.fault = form.fault
  else {
    input.status = form.status
    if (form.binary) {
      input.base64Body = form.binary.base64
      input.headers = { 'Content-Type': form.binary.contentType }
    } else if (form.body !== '') input.body = form.body
  }
  if (form.answer !== 'proxy') {
    if (!form.fault && form.preset === 'timeout') input.delayMs = TIMEOUT_DELAY_MS
    else if (form.slow) input.delayMs = Math.round(form.delaySeconds * 1000)
  }
  if (form.webhook.enabled) input.webhook = webhookInput(form.webhook)
  if (form.scenario.enabled) input.scenario = scenarioInput(form.scenario)
  if (form.name.trim() !== '') input.name = form.name
  return input
}

function scenarioInput(scenario: ScenarioForm): NonNullable<SimpleMockInput['scenario']> {
  const out: NonNullable<SimpleMockInput['scenario']> = { name: scenario.name.trim() }
  if (scenario.requiredState.trim() !== '') out.requiredState = scenario.requiredState.trim()
  if (scenario.newState.trim() !== '') out.newState = scenario.newState.trim()
  return out
}

function webhookInput(hook: WebhookForm): NonNullable<SimpleMockInput['webhook']> {
  const out: NonNullable<SimpleMockInput['webhook']> = { method: hook.method, url: hook.url.trim() }
  const headers = headerMap(hook.headers)
  if (headers) out.headers = headers
  if (hook.body !== '') out.body = hook.body
  if (hook.delay === 'fixed') out.delay = { type: 'fixed', milliseconds: hook.delayMs }
  else if (hook.delay === 'uniform') out.delay = { type: 'uniform', lower: hook.lower, upper: hook.upper }
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const onlyKeys = (obj: Record<string, unknown>, allowed: readonly string[]) => Object.keys(obj).every((k) => allowed.includes(k))

// Same as the server builder's escapeRegex (not imported: that module pulls zod and server code).
const escapeRegex = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')

/** The request URL the builder writes for an endpoint under its integration's prefix. */
function urlFor(integration: Integration, endpoint: Endpoint): string {
  const root = integration.prefix === '/' ? '' : integration.prefix
  return endpoint.pathType === 'regex' ? escapeRegex(root) + endpoint.path : root + endpoint.path
}

const URL_FIELD: Record<Endpoint['pathType'], string> = { exact: 'urlPath', template: 'urlPathTemplate', regex: 'urlPathPattern' }
const LOOKUP_FIELD = {
  jsonPath: 'bodyPatterns',
  xPath: 'bodyPatterns',
  query: 'queryParameters',
  path: 'pathParameters',
  header: 'headers',
  form: 'formParameters',
} as const

/** Reads the key value out of the lookup matcher the builder writes; undefined when the shape differs. */
function readKey(request: Record<string, unknown>, lookup: NonNullable<Endpoint['lookup']>): string | undefined {
  const value = request[LOOKUP_FIELD[lookup.location]]
  let match: unknown
  if (lookup.location === 'jsonPath' || lookup.location === 'xPath') {
    if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return undefined
    const op = lookup.location === 'jsonPath' ? 'matchesJsonPath' : 'matchesXPath'
    const pattern = value[0][op]
    if (!onlyKeys(value[0], [op]) || !isRecord(pattern) || !onlyKeys(pattern, ['expression', 'equalTo'])) return undefined
    if (pattern.expression !== lookup.expression) return undefined
    match = pattern.equalTo
  } else {
    if (!isRecord(value) || !onlyKeys(value, [lookup.expression]) || !isRecord(value[lookup.expression])) return undefined
    const matcher = value[lookup.expression] as Record<string, unknown>
    if (!onlyKeys(matcher, ['equalTo'])) return undefined
    match = matcher.equalTo
  }
  return typeof match === 'string' ? match : undefined
}

/**
 * Turns a stored stub back into the Simple form for its endpoint, or null when the stub holds anything the
 * form cannot show (extra matchers, headers, transformers, another priority…): Simple mode never drops fields.
 */
export function fromStub(stub: StubMapping, integration: Integration, endpoint: Endpoint): SimpleForm | null {
  if (!onlyKeys(stub, ['id', 'uuid', 'name', 'priority', 'persistent', 'request', 'response', 'metadata', 'serveEventListeners', ...SCENARIO_KEYS])) return null
  const meta = stub.metadata
  if (!isRecord(meta) || !onlyKeys(meta, ['wiremockUi'])) return null
  if (meta.wiremockUi?.integration !== endpoint.integration || meta.wiremockUi?.endpoint !== endpoint.key) return null

  // Request: method, the endpoint's URL field, and (for a key mock) exactly the lookup matcher.
  const { request, response } = stub
  if (!isRecord(request) || !isRecord(response)) return null
  const urlField = URL_FIELD[endpoint.pathType]
  const url = request[urlField]
  if (request.method !== endpoint.method || url !== urlFor(integration, endpoint)) return null
  const lookupField = endpoint.lookup ? LOOKUP_FIELD[endpoint.lookup.location] : undefined
  const isDefault = lookupField === undefined || !(lookupField in request)
  if (!onlyKeys(request, isDefault ? ['method', urlField] : ['method', urlField, lookupField!])) return null
  const keyValue = isDefault ? '' : readKey(request, endpoint.lookup!)
  if (keyValue === undefined) return null
  if (stub.priority !== (isDefault ? PRIORITY.default : PRIORITY.key)) return null

  const form = emptyForm(endpoint)
  form.isDefault = isDefault
  form.keyValue = keyValue
  if (stub.scenarioName !== undefined || stub.requiredScenarioState !== undefined || stub.newScenarioState !== undefined) {
    const scenario = readScenario(stub)
    if (!scenario) return null
    form.scenario = scenario
  }
  if (stub.serveEventListeners !== undefined) {
    const webhook = readWebhook(stub.serveEventListeners, form.webhook)
    if (!webhook) return null
    form.webhook = webhook
  }

  // Response: a proxy, a fault, or a status with the endpoint's content type and an optional body; either may be delayed.
  const delay = response.fixedDelayMilliseconds
  if (delay !== undefined && typeof delay !== 'number') return null
  if (response.proxyBaseUrl !== undefined) {
    const proxy = readProxy(response)
    if (!proxy) return null
    form.answer = 'proxy'
    form.proxy = proxy
  } else if (response.fault !== undefined) {
    if (!isFault(response.fault) || !onlyKeys(response, ['fault', 'fixedDelayMilliseconds'])) return null
    form.fault = response.fault
    form.body = ''
  } else if (response.base64Body !== undefined) {
    // A body uploaded from a file: the builder writes the file's Content-Type and nothing else.
    if (!onlyKeys(response, ['status', 'headers', 'base64Body', 'fixedDelayMilliseconds'])) return null
    const { status, headers, base64Body } = response
    if (typeof status !== 'number' || typeof base64Body !== 'string' || !isRecord(headers) || !onlyKeys(headers, ['Content-Type'])) return null
    const contentType = headers['Content-Type']
    if (typeof contentType !== 'string' || contentType === '') return null
    form.status = status
    form.preset = presetForStatus(status, delay)
    form.body = ''
    form.binary = { base64: base64Body, name: '', size: base64Size(base64Body), contentType }
    if (form.preset === 'timeout') return finish(stub, endpoint, form)
  } else {
    const bodyField = endpoint.contentType === 'json' ? 'jsonBody' : 'body'
    if (!onlyKeys(response, ['status', 'headers', bodyField, 'fixedDelayMilliseconds'])) return null
    const { status, headers } = response
    if (typeof status !== 'number' || !isRecord(headers) || !onlyKeys(headers, ['Content-Type'])) return null
    if (headers['Content-Type'] !== MIME[endpoint.contentType]) return null
    form.status = status
    form.preset = presetForStatus(status, delay)
    if (!(bodyField in response)) form.body = ''
    else if (bodyField === 'jsonBody') form.body = JSON.stringify(response.jsonBody, null, 2)
    else if (typeof response.body === 'string') form.body = response.body
    else return null
    if (form.preset === 'timeout') return finish(stub, endpoint, form)
  }

  if (delay !== undefined) {
    const seconds = delay / 1000
    if (!Number.isInteger(seconds) || seconds < SLOW_MIN_SECONDS || seconds > SLOW_MAX_SECONDS) return null
    form.slow = true
    form.delaySeconds = seconds
  }
  return finish(stub, endpoint, form)
}

const isStringMap = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => typeof x === 'string')
const rowsOf = (map: Record<string, string>): HeaderRow[] => Object.entries(map).map(([name, value]) => ({ name, value }))
const isDelayMs = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

const SCENARIO_KEYS = ['scenarioName', 'requiredScenarioState', 'newScenarioState'] as const
const isTrimmedText = (v: unknown): v is string => typeof v === 'string' && v !== '' && v === v.trim()

/** A scenario as the builder writes it: a name and a required state, maybe a new state (all trimmed, none empty). */
function readScenario(stub: StubMapping): ScenarioForm | null {
  const { scenarioName: name, requiredScenarioState: required, newScenarioState: next } = stub
  // Without a required state the mock answers in any state, which the form cannot say.
  if (!isTrimmedText(name) || !isTrimmedText(required)) return null
  if (next !== undefined && !isTrimmedText(next)) return null
  return { enabled: true, name, requiredState: required, newState: next ?? '' }
}

/** The proxy fields the builder writes, or null for anything else. */
function readProxy(response: Record<string, unknown>): ProxyForm | null {
  const keys = ['proxyBaseUrl', 'additionalProxyRequestHeaders', 'removeProxyRequestHeaders', 'proxyUrlPrefixToRemove', 'fixedDelayMilliseconds']
  if (!onlyKeys(response, keys)) return null
  const { proxyBaseUrl, additionalProxyRequestHeaders: add, removeProxyRequestHeaders: remove, proxyUrlPrefixToRemove: prefix } = response
  if (typeof proxyBaseUrl !== 'string') return null
  if (add !== undefined && !isStringMap(add)) return null
  // The builder lower-cases names and the form separates them with commas or spaces.
  if (remove !== undefined) {
    if (!Array.isArray(remove) || remove.length === 0) return null
    if (!remove.every((h) => typeof h === 'string' && h !== '' && h === h.toLowerCase() && !/[\s,]/.test(h))) return null
  }
  if (prefix !== undefined && (typeof prefix !== 'string' || !prefix.startsWith('/') || prefix !== prefix.trim())) return null
  if (proxyBaseUrl !== proxyBaseUrl.trim()) return null
  return {
    baseUrl: proxyBaseUrl,
    stripPrefix: (prefix as string | undefined) ?? '',
    addHeaders: add ? rowsOf(add) : [],
    removeHeaders: remove ? (remove as string[]).join(', ') : '',
  }
}

/** One webhook listener as the builder writes it (method, URL, optional headers/body, fixed or uniform delay). */
function readWebhook(listeners: unknown, defaults: WebhookForm): WebhookForm | null {
  if (!Array.isArray(listeners) || listeners.length !== 1) return null
  const listener = listeners[0]
  if (!isRecord(listener) || !onlyKeys(listener, ['name', 'parameters']) || listener.name !== 'webhook') return null
  const p = listener.parameters
  if (!isRecord(p) || !onlyKeys(p, ['method', 'url', 'headers', 'body', 'delay'])) return null
  if (!isWebhookMethod(p.method) || typeof p.url !== 'string' || p.url !== p.url.trim()) return null
  if (p.headers !== undefined && !isStringMap(p.headers)) return null
  if (p.body !== undefined && (typeof p.body !== 'string' || p.body === '')) return null
  const hook: WebhookForm = {
    ...defaults,
    enabled: true,
    method: p.method,
    url: p.url,
    headers: p.headers ? rowsOf(p.headers as Record<string, string>) : [],
    body: (p.body as string | undefined) ?? '',
  }
  const d = p.delay
  if (d === undefined) return hook
  if (!isRecord(d)) return null
  if (d.type === 'fixed' && onlyKeys(d, ['type', 'milliseconds']) && isDelayMs(d.milliseconds)) {
    return { ...hook, delay: 'fixed', delayMs: d.milliseconds }
  }
  if (d.type === 'uniform' && onlyKeys(d, ['type', 'lower', 'upper']) && isDelayMs(d.lower) && isDelayMs(d.upper)) {
    return { ...hook, delay: 'uniform', lower: d.lower, upper: d.upper }
  }
  return null
}

function finish(stub: StubMapping, endpoint: Endpoint, form: SimpleForm): SimpleForm {
  const name = typeof stub.name === 'string' ? stub.name : ''
  form.name = name === generatedName(endpoint, form) ? '' : name
  return form
}

/** The catalog endpoint a mock belongs to (kept in `metadata.wiremockUi`). */
export type CatalogLink = { integration: string; endpoint: string }

/** A stub as Advanced mode edits it: no id, uuid or `persistent` (the server always sets it) and no `metadata.wiremockUi`. */
export type EditableStub = Record<string, unknown>

export function linkOf(stub: Pick<StubMapping, 'metadata'>): CatalogLink | undefined {
  const ui = stub.metadata?.wiremockUi
  return ui?.integration && ui.endpoint ? { integration: ui.integration, endpoint: ui.endpoint } : undefined
}

/** The editable part of a stub: everything except the fields the server owns. */
export function toEditable(stub: Omit<StubMapping, 'id'> & { id?: string }): EditableStub {
  const { id: _id, uuid: _uuid, persistent: _persistent, metadata, ...rest } = stub as Record<string, unknown>
  if (!isRecord(metadata)) return rest
  const { wiremockUi: _ui, ...other } = metadata
  return Object.keys(other).length > 0 ? { ...rest, metadata: other } : rest
}

/** The stub to send for an edited JSON: the catalog link goes back into `metadata.wiremockUi`; nothing else of it. */
export function fromEditable(editable: EditableStub, link: CatalogLink | undefined): Omit<StubMapping, 'id'> {
  const { id: _id, uuid: _uuid, metadata, ...rest } = editable
  const other = isRecord(metadata) ? Object.fromEntries(Object.entries(metadata).filter(([k]) => k !== 'wiremockUi')) : {}
  const meta = link ? { ...other, wiremockUi: { integration: link.integration, endpoint: link.endpoint } } : other
  return { ...rest, ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}) } as Omit<StubMapping, 'id'>
}

export type StubJson =
  | { ok: true; value: EditableStub }
  | { ok: false; reason: 'syntax' | 'notObject'; message: string; line?: number; column?: number }

/** Line and column (1-based) of a character offset. */
function position(text: string, offset: number) {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 }
}

/** Parses the Advanced editor's text; a syntax error carries its line and column. */
export function parseStubJson(text: string): StubJson {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    // V8: "… at position 36 (line 4 column 2)"; Firefox: "… at line 4 column 2 of the JSON data"; Safari: none.
    const lc = /line (\d+) column (\d+)/.exec(raw)
    const pos = /position (\d+)/.exec(raw)
    // Without a position, only "unexpected end" can be placed (at the end); other messages go without one.
    const at = lc
      ? { line: Number(lc[1]), column: Number(lc[2]) }
      : pos
        ? position(text, Number(pos[1]))
        : /end of (JSON )?input|unexpected end/i.test(raw)
          ? position(text, text.length)
          : {}
    const message = raw
      .replace(/^JSON\.parse: /, '')
      .replace(/\s*\(line \d+ column \d+\)/, '')
      .replace(/\s*at line \d+ column \d+ of the JSON data/, '')
      .replace(/\s*(in JSON )?at position \d+/, '')
    return { ok: false, reason: 'syntax', message, ...at }
  }
  if (!isRecord(value)) return { ok: false, reason: 'notObject', message: '' }
  return { ok: true, value }
}

// ── Quick URL mocks ("Mock a URL directly") ─────────────────────────────────────────────────────────────────────
// Keep in step with the server's buildQuickStub (src/server/catalog/build.ts): what it writes is what we read back.

export const QUICK_METHODS: readonly QuickMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']
export const QUICK_URL_TYPES: readonly QuickUrlType[] = ['path', 'template', 'regex']
const QUICK_URL_FIELD: Record<QuickUrlType, string> = { path: 'urlPath', template: 'urlPathTemplate', regex: 'urlPathPattern' }

/** `application/json`, `application/problem+json; charset=utf-8`… (same rule as the server's isJsonContentType). */
export const isJsonContentType = (type: string | undefined) => type !== undefined && /^[^;]*[/+]json\s*(;|$)/i.test(type.trim())

/** The name the server gives a quick mock when the form's name is empty. */
export const quickMockName = (quick: Pick<QuickRequest, 'method' | 'url'>) => `${quick.method} ${quick.url.trim()}`

/** The Content-Type among the rows ('' when none). */
export const contentTypeOf = (rows: HeaderRow[]) => rows.find((r) => r.name.trim().toLowerCase() === 'content-type')?.value.trim() ?? ''

/** A quick mock has no integration: the Simple form's pieces that need one see this (prefix `/`). */
export const QUICK_INTEGRATION: Integration = { key: '', name: '', prefix: '/', updatedAt: '', updatedBy: '' }

/** The quick request as an endpoint, so the Simple form's shared parts (presets, body editor, proxy route) work as usual. */
export function quickEndpoint(quick: QuickRequest): Endpoint {
  const type = contentTypeOf(quick.responseHeaders).toLowerCase()
  const contentType: Endpoint['contentType'] = isJsonContentType(type) ? 'json' : type.includes('xml') ? 'xml' : type.includes('html') ? 'html' : 'text'
  return {
    integration: '',
    key: '',
    name: quickMockName(quick),
    method: quick.method,
    path: quick.url.trim() || '/',
    pathType: quick.urlType === 'path' ? 'exact' : quick.urlType,
    contentType,
    exampleResponses: {},
    allowedStatuses: [],
    updatedAt: '',
    updatedBy: '',
  }
}

/** A fresh quick form: GET /, answering 200 with a JSON Content-Type and no body. */
export function emptyQuickForm(seed?: ScenarioSeed): SimpleForm {
  const quick: QuickRequest = {
    method: 'GET',
    urlType: 'path',
    url: '/',
    query: [],
    body: '',
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
  }
  const form: SimpleForm = { ...emptyForm(quickEndpoint(quick)), integration: '', endpoint: '', isDefault: true, body: '', quick }
  return seedScenario(form, seed)
}

/** The body the quick preview accepts: the Simple form's response, the form's own request and response headers. */
export function toQuickInput(form: SimpleForm): QuickMockInput {
  const quick = form.quick!
  const { isDefault: _d, keyValue: _k, headers: _h, ...rest } = toSimpleInput(form)
  const request: QuickMockInput['request'] = { method: quick.method, urlType: quick.urlType, url: quick.url.trim() }
  const query = headerMap(quick.query)
  if (query) request.query = query
  if (quick.body.trim() !== '') request.body = quick.body
  const input: QuickMockInput = { request, ...rest }
  if (form.answer !== 'proxy' && !form.fault) {
    // A binary body brings its own Content-Type; any typed one gives way to it.
    const rows = form.binary ? quick.responseHeaders.filter((r) => r.name.trim().toLowerCase() !== 'content-type') : quick.responseHeaders
    const headers = { ...headerMap(rows), ...(form.binary ? { 'Content-Type': form.binary.contentType } : {}) }
    if (Object.keys(headers).length > 0) input.headers = headers
  }
  return input
}

const isText = (v: unknown): v is string => typeof v === 'string'
const parsesAsJson = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** The quick request the builder writes, or null for anything else. */
function readQuickRequest(request: Record<string, unknown>): Omit<QuickRequest, 'responseHeaders'> | null {
  const method = request.method
  if (!QUICK_METHODS.includes(method as QuickMethod)) return null
  const types = QUICK_URL_TYPES.filter((type) => QUICK_URL_FIELD[type] in request)
  if (types.length !== 1) return null
  const urlType = types[0]!
  const urlField = QUICK_URL_FIELD[urlType]
  if (!onlyKeys(request, ['method', urlField, 'queryParameters', 'bodyPatterns'])) return null
  const url = request[urlField]
  if (!isText(url) || url === '' || /\s/.test(url)) return null
  if (urlType !== 'regex' && (!url.startsWith('/') || url.includes('?'))) return null

  const query: HeaderRow[] = []
  if (request.queryParameters !== undefined) {
    const params = request.queryParameters
    if (!isRecord(params) || Object.keys(params).length === 0) return null
    for (const [name, matcher] of Object.entries(params)) {
      if (name.trim() !== name || name === '' || !isRecord(matcher) || !onlyKeys(matcher, ['equalTo']) || !isText(matcher.equalTo)) return null
      query.push({ name, value: matcher.equalTo })
    }
  }
  let body = ''
  if (request.bodyPatterns !== undefined) {
    const patterns = request.bodyPatterns
    if (!Array.isArray(patterns) || patterns.length !== 1 || !isRecord(patterns[0])) return null
    const p = patterns[0]
    if (onlyKeys(p, ['equalToJson', 'ignoreExtraElements']) && p.ignoreExtraElements === true && isText(p.equalToJson) && parsesAsJson(p.equalToJson)) {
      body = p.equalToJson
    } else if (onlyKeys(p, ['contains']) && isText(p.contains) && p.contains.trim() !== '' && !parsesAsJson(p.contains)) {
      body = p.contains
    } else return null
  }
  return { method: method as QuickMethod, urlType, url, query, body }
}

/**
 * Turns a free-form stub back into the quick form, or null when it holds anything the form cannot show
 * (a catalog link, a priority, other matchers or response fields…): like fromStub, the form never drops fields.
 */
export function fromQuickStub(stub: StubMapping): SimpleForm | null {
  if (!onlyKeys(stub, ['id', 'uuid', 'name', 'persistent', 'request', 'response', 'metadata', 'serveEventListeners', ...SCENARIO_KEYS])) return null
  if (stub.name !== undefined && !isText(stub.name)) return null
  const meta = stub.metadata
  if (meta !== undefined) {
    if (!isRecord(meta) || !onlyKeys(meta, ['wiremockUi'])) return null
    if (meta.wiremockUi?.integration !== undefined || meta.wiremockUi?.endpoint !== undefined) return null
  }
  const { request, response } = stub
  if (!isRecord(request) || !isRecord(response)) return null
  const read = readQuickRequest(request)
  if (!read) return null

  const form = emptyQuickForm()
  // A proxy or a fault sends no headers of ours: the form keeps its default ones (unused until it answers itself).
  const quick: QuickRequest = { ...read, responseHeaders: form.quick!.responseHeaders }
  form.quick = quick
  if (stub.scenarioName !== undefined || stub.requiredScenarioState !== undefined || stub.newScenarioState !== undefined) {
    const scenario = readScenario(stub)
    if (!scenario) return null
    form.scenario = scenario
  }
  if (stub.serveEventListeners !== undefined) {
    const webhook = readWebhook(stub.serveEventListeners, form.webhook)
    if (!webhook) return null
    form.webhook = webhook
  }

  const delay = response.fixedDelayMilliseconds
  if (delay !== undefined && typeof delay !== 'number') return null
  if (response.proxyBaseUrl !== undefined) {
    const proxy = readProxy(response)
    if (!proxy) return null
    form.answer = 'proxy'
    form.proxy = proxy
  } else if (response.fault !== undefined) {
    if (!isFault(response.fault) || !onlyKeys(response, ['fault', 'fixedDelayMilliseconds'])) return null
    form.fault = response.fault
  } else {
    if (!onlyKeys(response, ['status', 'headers', 'body', 'jsonBody', 'base64Body', 'fixedDelayMilliseconds'])) return null
    const bodies = ['body', 'jsonBody', 'base64Body'].filter((k) => k in response)
    if (bodies.length > 1) return null
    const { status, headers } = response
    if (typeof status !== 'number') return null
    if (headers !== undefined && !isStringMap(headers)) return null
    const rows = headers ? rowsOf(headers as Record<string, string>) : []
    const type = contentTypeOf(rows)
    if (response.base64Body !== undefined) {
      // The builder writes the file's type as `Content-Type`, next to any other headers.
      const contentType = headers ? (headers as Record<string, string>)['Content-Type'] : undefined
      if (!isText(response.base64Body) || !contentType) return null
      form.binary = { base64: response.base64Body, name: '', size: base64Size(response.base64Body), contentType }
      quick.responseHeaders = rows.filter((r) => r.name !== 'Content-Type')
    } else {
      if (response.jsonBody !== undefined) {
        if (!isJsonContentType(type)) return null
        form.body = JSON.stringify(response.jsonBody, null, 2)
      } else if (response.body !== undefined) {
        if (!isText(response.body) || response.body === '' || isJsonContentType(type)) return null
        form.body = response.body
      }
      quick.responseHeaders = rows
    }
    form.status = status
    form.preset = presetForStatus(status, delay)
    if (form.preset === 'timeout') return finishQuick(stub, form)
  }

  if (delay !== undefined) {
    const seconds = delay / 1000
    if (!Number.isInteger(seconds) || seconds < SLOW_MIN_SECONDS || seconds > SLOW_MAX_SECONDS) return null
    form.slow = true
    form.delaySeconds = seconds
  }
  return finishQuick(stub, form)
}

function finishQuick(stub: StubMapping, form: SimpleForm): SimpleForm {
  const name = typeof stub.name === 'string' ? stub.name : ''
  form.name = name === quickMockName(form.quick!) ? '' : name
  return form
}
