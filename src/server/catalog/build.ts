import { z } from 'zod'
import { normaliseTags } from '../mocks/tags'
import { ValidationError } from '../errors'
import { assertBase64Body, assertHttpUrl, assertWebhook } from '../mocks/power-fields'
import { trimTrailingSlashes } from '../url'
import type { MockInput } from '../mocks/service'

const FAULTS = ['EMPTY_RESPONSE', 'MALFORMED_RESPONSE_CHUNK', 'RANDOM_DATA_THEN_CLOSE', 'CONNECTION_RESET_BY_PEER'] as const

const unknownKeys = (iss: { code?: string; keys?: string[] }, fallback: string) =>
  iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys!.join(', ')}` : fallback

const headerMap = (field: string) =>
  z.record(z.string().min(1, `${field}: names must not be empty`), z.string({ error: `${field} values must be strings` }), {
    error: `${field} must be an object of strings`,
  })

/** Forward to a real service (WireMock's proxyBaseUrl and friends). */
const proxySchema = z.strictObject(
  {
    baseUrl: z.string({ error: 'proxy.baseUrl must be a string' }),
    addHeaders: headerMap('proxy.addHeaders').optional(),
    removeHeaders: z
      .array(z.string().min(1, 'proxy.removeHeaders: names must not be empty'), { error: 'proxy.removeHeaders must be a list of header names' })
      .optional(),
    stripPrefix: z.string({ error: 'proxy.stripPrefix must be a string' }).optional(),
  },
  { error: (iss) => unknownKeys(iss, 'proxy must be an object') },
)

const delayMs = (field: string) => z.number({ error: `${field} must be a number` })
/** Call back after responding (one WireMock webhook serveEventListener); lognormal delays are Advanced-only. */
const webhookSchema = z.strictObject(
  {
    method: z.string({ error: 'webhook.method must be a string' }),
    url: z.string({ error: 'webhook.url must be a string' }),
    headers: headerMap('webhook.headers').optional(),
    body: z.string({ error: 'webhook.body must be a string' }).optional(),
    delay: z
      .discriminatedUnion(
        'type',
        [
          z.strictObject({ type: z.literal('fixed'), milliseconds: delayMs('webhook.delay.milliseconds') }),
          z.strictObject({ type: z.literal('uniform'), lower: delayMs('webhook.delay.lower'), upper: delayMs('webhook.delay.upper') }),
        ],
        { error: 'webhook.delay must be { type: "fixed", milliseconds } or { type: "uniform", lower, upper }' },
      )
      .optional(),
  },
  { error: (iss) => unknownKeys(iss, 'webhook must be an object') },
)

/** Make the mock stateful (WireMock scenarioName / requiredScenarioState / newScenarioState). */
const scenarioSchema = z.strictObject(
  {
    name: z.string({ error: 'scenario.name must be a string' }),
    requiredState: z.string({ error: 'scenario.requiredState must be a string' }).optional(),
    newState: z.string({ error: 'scenario.newState must be a string' }).optional(),
  },
  { error: (iss) => unknownKeys(iss, 'scenario must be an object') },
)

/** WireMock's first state of every scenario. */
export const SCENARIO_STARTED = 'Started'

export const simpleMockSchema = z.strictObject(
  {
    keyValue: z.string({ error: 'keyValue must be a string' }).optional(),
    isDefault: z.boolean({ error: 'isDefault must be a boolean' }).optional(),
    status: z
      .number({ error: 'status must be a number' })
      .int('status must be an integer')
      .min(100, 'status must be between 100 and 599')
      .max(599, 'status must be between 100 and 599')
      .optional(),
    body: z.string({ error: 'body must be a string' }).optional(),
    /** A binary body (an uploaded file) as base64; its Content-Type comes from `headers`. */
    base64Body: z.string({ error: 'base64Body must be a string' }).optional(),
    headers: z
      .record(z.string().min(1, 'headers: names must not be empty'), z.string({ error: 'headers values must be strings' }), {
        error: 'headers must be an object of strings',
      })
      .optional(),
    delayMs: z
      .number({ error: 'delayMs must be a number' })
      .int('delayMs must be an integer')
      .min(0, 'delayMs must be between 0 and 120000')
      .max(120000, 'delayMs must be between 0 and 120000')
      .optional(),
    fault: z.enum(FAULTS, { error: `fault must be one of ${FAULTS.join(', ')}` }).optional(),
    name: z.string({ error: 'name must be a string' }).optional(),
    proxy: proxySchema.optional(),
    webhook: webhookSchema.optional(),
    scenario: scenarioSchema.optional(),
    /** The mock's tags (normalised by normaliseTags; see src/server/mocks/tags.ts). */
    tags: z.array(z.string({ error: 'tags must be a list of strings' }), { error: 'tags must be a list of strings' }).optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)

export type SimpleMockInput = z.infer<typeof simpleMockSchema>

/** A binary body whose type is not known. */
export const BINARY_MIME = 'application/octet-stream'

/** A proxied mock's response: WireMock forwards, so there is no status, header or body of ours. */
function proxyResponse(proxy: NonNullable<SimpleMockInput['proxy']>): Record<string, unknown> {
  assertHttpUrl(proxy.baseUrl, 'proxy.baseUrl')
  if (proxy.stripPrefix !== undefined && !proxy.stripPrefix.startsWith('/')) throw new ValidationError('proxy.stripPrefix must start with /')
  // `https://api.example.com/` would forward to `https://api.example.com//path`: trailing slashes are dropped.
  const response: Record<string, unknown> = { proxyBaseUrl: trimTrailingSlashes(proxy.baseUrl.trim()) }
  if (proxy.addHeaders && Object.keys(proxy.addHeaders).length > 0) response.additionalProxyRequestHeaders = proxy.addHeaders
  // WireMock 3.13.1 only removes names listed in lower case (tests/server/wiremock/power-features.test.ts).
  if (proxy.removeHeaders && proxy.removeHeaders.length > 0) response.removeProxyRequestHeaders = proxy.removeHeaders.map((h) => h.toLowerCase())
  if (proxy.stripPrefix !== undefined) response.proxyUrlPrefixToRemove = proxy.stripPrefix
  return response
}

/** WireMock's webhook serveEventListener; empty headers and body are left out. */
export function webhookListener(webhook: NonNullable<SimpleMockInput['webhook']>): WebhookListener {
  const parameters: WebhookListener['parameters'] = { method: webhook.method.toUpperCase(), url: webhook.url }
  if (webhook.headers && Object.keys(webhook.headers).length > 0) parameters.headers = webhook.headers
  if (webhook.body) parameters.body = webhook.body
  if (webhook.delay) parameters.delay = webhook.delay
  assertWebhook(parameters, 'webhook')
  return { name: 'webhook', parameters }
}

export type WebhookListener = {
  name: 'webhook'
  parameters: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
    delay?: { type: 'fixed'; milliseconds: number } | { type: 'uniform'; lower: number; upper: number }
  }
}

export type ScenarioFields = { scenarioName: string; requiredScenarioState: string; newScenarioState?: string }

/** A blank required state means `Started`; a blank new state means the mock leaves the state as it is. */
function scenarioFields(scenario: NonNullable<SimpleMockInput['scenario']>): ScenarioFields {
  const name = scenario.name.trim()
  if (name === '') throw new ValidationError('scenario.name must not be empty')
  const newState = scenario.newState?.trim()
  return {
    scenarioName: name,
    requiredScenarioState: scenario.requiredState?.trim() || SCENARIO_STARTED,
    ...(newState ? { newScenarioState: newState } : {}),
  }
}

// ── Quick URL mocks ("Mock a URL directly"): the Simple form without an integration ──────────────────────────────

/** The methods the quick form offers (`ANY` matches every method), as the endpoint form does. */
export const QUICK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'] as const
/** How the URL matches: the exact path, a path template (`/users/{id}`) or a regular expression over the path. */
export const QUICK_URL_TYPES = ['path', 'template', 'regex'] as const
export const QUICK_URL_FIELD = { path: 'urlPath', template: 'urlPathTemplate', regex: 'urlPathPattern' } as const

const quickRequestSchema = z.strictObject(
  {
    method: z.enum(QUICK_METHODS, { error: `request.method must be one of ${QUICK_METHODS.join(', ')}` }),
    urlType: z.enum(QUICK_URL_TYPES, { error: `request.urlType must be one of ${QUICK_URL_TYPES.join(', ')}` }),
    url: z.string({ error: 'request.url must be a string' }),
    /** Query parameters the request must carry, each matched with equalTo. */
    query: headerMap('request.query').optional(),
    /** Request body to match: JSON → equalToJson (extra fields ignored), any other text → contains. */
    body: z.string({ error: 'request.body must be a string' }).optional(),
  },
  { error: (iss) => unknownKeys(iss, 'request must be an object') },
)

/** The Simple form's response fields with a method and URL of its own instead of a catalog endpoint and key. */
export const quickMockSchema = simpleMockSchema.omit({ keyValue: true, isDefault: true }).extend({
  request: quickRequestSchema,
  /** WireMock's priority when several mocks match: 1 wins over 2, and so on. Left out: WireMock's default (5). */
  priority: z
    .number({ error: 'priority must be a whole number of 1 or more' })
    .int({ error: 'priority must be a whole number of 1 or more' })
    .min(1, { error: 'priority must be a whole number of 1 or more' })
    .optional(),
})

export type QuickMockInput = z.infer<typeof quickMockSchema>

/** `application/json`, `application/problem+json; charset=utf-8`… */
export const isJsonContentType = (type: string | undefined) => type !== undefined && /^[^;]*[/+]json\s*(;|$)/i.test(type.trim())

/** The name a quick mock gets when none is given. */
export const quickMockName = (request: Pick<QuickMockInput['request'], 'method' | 'url'>) => `${request.method} ${request.url.trim()}`

/** A JSON object or array (what equalToJson with extra fields allowed makes sense for); scalars are plain text. */
export function isJsonDocument(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}

export function quickRequest(r: QuickMockInput['request']): Record<string, unknown> {
  const url = r.url.trim()
  if (url === '') throw new ValidationError('request.url is required')
  if (/\s/.test(url)) throw new ValidationError('request.url must not contain spaces')
  if (r.urlType !== 'regex') {
    if (!url.startsWith('/')) throw new ValidationError('request.url must start with /')
    if (url.includes('?')) throw new ValidationError('request.url must not contain a query string; add the query parameters to match instead')
  } else {
    // Same check as the endpoint rules: WireMock's (Java) dialect differs a little, but a pattern JS can't parse
    // would only fail later with a generic WireMock error.
    try {
      new RegExp(url)
    } catch {
      throw new ValidationError('request.url must be a valid regular expression')
    }
  }
  const request: Record<string, unknown> = { method: r.method, [QUICK_URL_FIELD[r.urlType]]: url }
  if (r.query && Object.keys(r.query).length > 0) {
    request.queryParameters = Object.fromEntries(Object.entries(r.query).map(([name, value]) => [name, { equalTo: value }]))
  }
  if (r.body !== undefined && r.body.trim() !== '') {
    request.bodyPatterns = [isJsonDocument(r.body) ? { equalToJson: r.body, ignoreExtraElements: true } : { contains: r.body }]
  }
  return request
}

/** A status with the headers as given; under a JSON Content-Type the body must be JSON and is sent as jsonBody. */
export function quickResponse(input: QuickMockInput): Record<string, unknown> {
  if (input.proxy) return proxyResponse(input.proxy)
  if (input.fault) return { fault: input.fault }
  const response: Record<string, unknown> = { status: input.status }
  const headers: Record<string, string> = { ...input.headers }
  const typeName = Object.keys(headers).find((h) => h.toLowerCase() === 'content-type')
  if (input.base64Body !== undefined) {
    if (input.body) throw new ValidationError('body and base64Body cannot be combined')
    assertBase64Body(input.base64Body, 'base64Body')
    if (!typeName) headers['Content-Type'] = BINARY_MIME
  }
  if (Object.keys(headers).length > 0) response.headers = headers
  if (input.base64Body !== undefined) response.base64Body = input.base64Body
  else if (input.body) {
    if (isJsonContentType(typeName && headers[typeName])) {
      try {
        response.jsonBody = JSON.parse(input.body)
      } catch {
        throw new ValidationError('body is not valid JSON')
      }
    } else response.body = input.body
  }
  return response
}

/**
 * Turns the quick form into a WireMock stub: a free-form mock (no catalog link; WireMock's default priority unless set) that
 * the editor reads back into the same form.
 */
export function buildQuickStub(input: QuickMockInput): MockInput & { serveEventListeners?: WebhookListener[] } & Partial<ScenarioFields> {
  const name = input.name?.trim()
  if (name === '') throw new ValidationError('name must not be empty')
  if (input.proxy && input.fault) {
    throw new ValidationError("proxy and fault cannot be combined: a proxied mock answers with the real service's response")
  }
  if (!input.fault && !input.proxy && input.status === undefined) throw new ValidationError('status is required')
  const request = quickRequest(input.request)
  const response = quickResponse(input)
  if (input.delayMs !== undefined) response.fixedDelayMilliseconds = input.delayMs
  return {
    name: name ?? quickMockName(input.request),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    request,
    response,
    ...(input.webhook ? { serveEventListeners: [webhookListener(input.webhook)] } : {}),
    ...(input.scenario ? scenarioFields(input.scenario) : {}),
    ...(normaliseTags(input.tags, 'tags') ? { metadata: { wiremockUi: tagsFor(input.tags) } } : {}),
  }
}

/** `{ tags }` for the stub's wiremockUi metadata, or nothing when there are none. */
function tagsFor(raw: string[] | undefined): { tags?: string[] } {
  const tags = normaliseTags(raw, 'tags')
  return tags ? { tags } : {}
}
