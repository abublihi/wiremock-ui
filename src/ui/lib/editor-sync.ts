import type { SimpleMockInput } from '@/server/catalog/build'
import type { Endpoint } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import {
  SLOW_MAX_SECONDS,
  SLOW_MIN_SECONDS,
  TIMEOUT_DELAY_MS,
  isFault,
  presetForStatus,
  presetToStatus,
  visiblePresets,
  type Fault,
  type Preset,
} from './presets'

export type SimpleForm = {
  integration: string
  endpoint: string
  isDefault: boolean
  keyValue: string
  preset: Preset
  status: number
  body: string
  slow: boolean
  delaySeconds: number
  fault: '' | Fault
  name: string
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
    slow: false,
    delaySeconds: DEFAULT_SLOW_SECONDS,
    fault: '',
    name: '',
  }
}

/** The name the server gives a mock when the form's name is empty. */
export function generatedName(endpoint: Endpoint, form: Pick<SimpleForm, 'isDefault' | 'keyValue'>): string {
  return `${endpoint.name} — ${form.isDefault ? 'default' : form.keyValue.trim()}`
}

/** The body the preview and create endpoints accept. */
export function toSimpleInput(form: SimpleForm): SimpleMockInput {
  const input: SimpleMockInput = form.isDefault ? { isDefault: true } : { keyValue: form.keyValue }
  if (form.fault) input.fault = form.fault
  else {
    input.status = form.status
    if (form.body !== '') input.body = form.body
  }
  if (!form.fault && form.preset === 'timeout') input.delayMs = TIMEOUT_DELAY_MS
  else if (form.slow) input.delayMs = Math.round(form.delaySeconds * 1000)
  if (form.name.trim() !== '') input.name = form.name
  return input
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const onlyKeys = (obj: Record<string, unknown>, allowed: readonly string[]) => Object.keys(obj).every((k) => allowed.includes(k))

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
export function fromStub(stub: StubMapping, endpoint: Endpoint): SimpleForm | null {
  if (!onlyKeys(stub, ['id', 'uuid', 'name', 'priority', 'persistent', 'request', 'response', 'metadata'])) return null
  const meta = stub.metadata
  if (!isRecord(meta) || !onlyKeys(meta, ['wiremockUi'])) return null
  if (meta.wiremockUi?.integration !== endpoint.integration || meta.wiremockUi?.endpoint !== endpoint.key) return null

  // Request: method, the endpoint's URL field, and (for a key mock) exactly the lookup matcher.
  const { request, response } = stub
  if (!isRecord(request) || !isRecord(response)) return null
  const urlField = URL_FIELD[endpoint.pathType]
  const url = request[urlField]
  if (request.method !== endpoint.method || typeof url !== 'string' || !url.endsWith(endpoint.path)) return null
  const lookupField = endpoint.lookup ? LOOKUP_FIELD[endpoint.lookup.location] : undefined
  const isDefault = lookupField === undefined || !(lookupField in request)
  if (!onlyKeys(request, isDefault ? ['method', urlField] : ['method', urlField, lookupField!])) return null
  const keyValue = isDefault ? '' : readKey(request, endpoint.lookup!)
  if (keyValue === undefined) return null
  if (stub.priority !== (isDefault ? PRIORITY.default : PRIORITY.key)) return null

  const form = emptyForm(endpoint)
  form.isDefault = isDefault
  form.keyValue = keyValue

  // Response: a fault, or a status with the endpoint's content type and an optional body; either may be delayed.
  const delay = response.fixedDelayMilliseconds
  if (delay !== undefined && typeof delay !== 'number') return null
  if (response.fault !== undefined) {
    if (!isFault(response.fault) || !onlyKeys(response, ['fault', 'fixedDelayMilliseconds'])) return null
    form.fault = response.fault
    form.body = ''
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

function finish(stub: StubMapping, endpoint: Endpoint, form: SimpleForm): SimpleForm {
  const name = typeof stub.name === 'string' ? stub.name : ''
  form.name = name === generatedName(endpoint, form) ? '' : name
  return form
}
