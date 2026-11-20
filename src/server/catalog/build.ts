import { z } from 'zod'
import { ValidationError } from '../errors'
import { assertHttpUrl, assertWebhook } from '../mocks/power-fields'
import type { MockInput } from '../mocks/service'
import type { Endpoint, Integration } from './types'

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
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)

export type SimpleMockInput = z.infer<typeof simpleMockSchema>

const MIME: Record<Endpoint['contentType'], string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
}

export const escapeRegex = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')

function requestFor(integration: Integration, endpoint: Endpoint, keyValue: string | undefined): Record<string, unknown> {
  const root = integration.prefix === '/' ? '' : integration.prefix
  const request: Record<string, unknown> = { method: endpoint.method }
  if (endpoint.pathType === 'exact') request.urlPath = root + endpoint.path
  else if (endpoint.pathType === 'template') request.urlPathTemplate = root + endpoint.path
  else request.urlPathPattern = escapeRegex(root) + endpoint.path

  if (keyValue !== undefined && endpoint.lookup) {
    const { location, expression } = endpoint.lookup
    const match = { equalTo: keyValue }
    if (location === 'jsonPath') request.bodyPatterns = [{ matchesJsonPath: { expression, ...match } }]
    else if (location === 'xPath') request.bodyPatterns = [{ matchesXPath: { expression, ...match } }]
    else if (location === 'query') request.queryParameters = { [expression]: match }
    else if (location === 'path') request.pathParameters = { [expression]: match }
    else if (location === 'header') request.headers = { [expression]: match }
    else request.formParameters = { [expression]: match }
  }
  return request
}

/** A proxied mock's response: WireMock forwards, so there is no status, header or body of ours. */
function proxyResponse(proxy: NonNullable<SimpleMockInput['proxy']>): Record<string, unknown> {
  assertHttpUrl(proxy.baseUrl, 'proxy.baseUrl')
  if (proxy.stripPrefix !== undefined && !proxy.stripPrefix.startsWith('/')) throw new ValidationError('proxy.stripPrefix must start with /')
  const response: Record<string, unknown> = { proxyBaseUrl: proxy.baseUrl }
  if (proxy.addHeaders && Object.keys(proxy.addHeaders).length > 0) response.additionalProxyRequestHeaders = proxy.addHeaders
  // WireMock 3.13.1 only removes names listed in lower case (tests/server/wiremock/power-features.test.ts).
  if (proxy.removeHeaders && proxy.removeHeaders.length > 0) response.removeProxyRequestHeaders = proxy.removeHeaders.map((h) => h.toLowerCase())
  if (proxy.stripPrefix !== undefined) response.proxyUrlPrefixToRemove = proxy.stripPrefix
  return response
}

/** WireMock's webhook serveEventListener; empty headers and body are left out. */
function webhookListener(webhook: NonNullable<SimpleMockInput['webhook']>): WebhookListener {
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

/** A status with the endpoint's content type, extra headers and an optional body. */
function mockResponse(endpoint: Endpoint, input: SimpleMockInput): Record<string, unknown> {
  const response: Record<string, unknown> = { status: input.status }
  const headers: Record<string, string> = { 'Content-Type': MIME[endpoint.contentType] }
  if (Object.keys(input.headers ?? {}).some((h) => h.toLowerCase() === 'content-type')) delete headers['Content-Type']
  response.headers = { ...headers, ...input.headers }
  if (input.body) {
    if (endpoint.contentType === 'json') {
      try {
        response.jsonBody = JSON.parse(input.body)
      } catch {
        throw new ValidationError('body is not valid JSON')
      }
    } else response.body = input.body
  }
  return response
}

function responseFor(endpoint: Endpoint, input: SimpleMockInput): Record<string, unknown> {
  // A proxied mock answers with the real service's status, headers and body; a fault sends none.
  const response = input.proxy ? proxyResponse(input.proxy) : input.fault ? { fault: input.fault } : mockResponse(endpoint, input)
  if (input.delayMs !== undefined) response.fixedDelayMilliseconds = input.delayMs
  return response
}

/** Turns a catalog endpoint plus a simple form into a WireMock stub definition. */
export function buildStub(
  integration: Integration,
  endpoint: Endpoint,
  input: SimpleMockInput,
): MockInput & { serveEventListeners?: WebhookListener[] } & Partial<ScenarioFields> {
  const isDefault = input.isDefault === true
  const keyValue = isDefault ? undefined : input.keyValue?.trim()
  const name = input.name?.trim()
  if (!isDefault) {
    if (!endpoint.lookup) throw new ValidationError('this endpoint has no lookup; only a default mock can be created')
    if (!keyValue) throw new ValidationError('keyValue is required')
  }
  if (name === '') throw new ValidationError('name must not be empty')
  if (input.proxy && input.fault) {
    throw new ValidationError("proxy and fault cannot be combined: a proxied mock answers with the real service's response")
  }
  // A fault or proxied mock sends no status of ours, so neither the status nor the allowed list applies to it.
  if (!input.fault && !input.proxy) {
    if (input.status === undefined) throw new ValidationError('status is required')
    if (endpoint.allowedStatuses.length > 0 && !endpoint.allowedStatuses.includes(input.status)) {
      throw new ValidationError(`status ${input.status} is not allowed for this endpoint`)
    }
  }
  return {
    name: name ?? `${endpoint.name} — ${isDefault ? 'default' : keyValue}`,
    priority: isDefault ? 10 : 5,
    request: requestFor(integration, endpoint, keyValue),
    response: responseFor(endpoint, input),
    ...(input.webhook ? { serveEventListeners: [webhookListener(input.webhook)] } : {}),
    ...(input.scenario ? scenarioFields(input.scenario) : {}),
    metadata: { wiremockUi: { integration: integration.key, endpoint: endpoint.key } },
  }
}
