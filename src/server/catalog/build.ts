import { z } from 'zod'
import { ValidationError } from '../errors'
import type { MockInput } from '../mocks/service'
import type { Endpoint, Integration } from './types'

const FAULTS = ['EMPTY_RESPONSE', 'MALFORMED_RESPONSE_CHUNK', 'RANDOM_DATA_THEN_CLOSE', 'CONNECTION_RESET_BY_PEER'] as const

export const simpleMockSchema = z.strictObject(
  {
    keyValue: z.string({ error: 'keyValue must be a string' }).optional(),
    isDefault: z.boolean({ error: 'isDefault must be a boolean' }).optional(),
    status: z
      .number({ error: 'status must be a number' })
      .int('status must be an integer')
      .min(100, 'status must be between 100 and 599')
      .max(599, 'status must be between 100 and 599'),
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

function responseFor(endpoint: Endpoint, input: SimpleMockInput): Record<string, unknown> {
  const response: Record<string, unknown> = {}
  if (input.fault) response.fault = input.fault
  else {
    response.status = input.status
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
  }
  if (input.delayMs !== undefined) response.fixedDelayMilliseconds = input.delayMs
  return response
}

/** Turns a catalog endpoint plus a simple form into a WireMock stub definition. */
export function buildStub(integration: Integration, endpoint: Endpoint, input: SimpleMockInput): MockInput {
  const isDefault = input.isDefault === true
  if (!isDefault) {
    if (!endpoint.lookup) throw new ValidationError('this endpoint has no lookup; only a default mock can be created')
    if (!input.keyValue) throw new ValidationError('keyValue is required')
  }
  if (endpoint.allowedStatuses.length > 0 && !endpoint.allowedStatuses.includes(input.status)) {
    throw new ValidationError(`status ${input.status} is not allowed for this endpoint`)
  }
  const keyValue = isDefault ? undefined : input.keyValue
  return {
    name: input.name ?? `${endpoint.name} — ${isDefault ? 'default' : keyValue}`,
    priority: isDefault ? 10 : 5,
    request: requestFor(integration, endpoint, keyValue),
    response: responseFor(endpoint, input),
    metadata: { wiremockUi: { integration: integration.key, endpoint: endpoint.key } },
  }
}
