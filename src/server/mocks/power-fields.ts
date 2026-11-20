import { ValidationError } from '../errors'

/**
 * Field rules for proxying (response.proxyBaseUrl …), webhooks (serveEventListeners) and scenarios, in WireMock
 * 3.13.1's own shapes. Webhook targets are not filtered: WireMock calls them from inside the user's test
 * environment, so pointing one at WireMock itself or at this UI is allowed.
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export const MAX_WEBHOOK_DELAY_MS = 60_000

function httpUrl(value: unknown, field: string, opts: { templated?: boolean } = {}): void {
  const message = `${field} must be an http:// or https:// URL`
  if (typeof value !== 'string' || !/^https?:\/\/\S/i.test(value)) throw new ValidationError(message)
  // A webhook URL may be a template ("http://{{request.headers.X-Host}}/cb"): only its scheme can be checked.
  if (opts.templated && value.includes('{{')) return
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.host === '') throw new ValidationError(message)
  } catch {
    throw new ValidationError(message)
  }
}

function stringMap(value: unknown, field: string): void {
  if (value === undefined) return
  if (!isObject(value)) throw new ValidationError(`${field} must be an object of header names to values`)
  for (const [name, v] of Object.entries(value)) {
    if (typeof v !== 'string') throw new ValidationError(`${field}.${name} must be a string`)
  }
}

function delayMs(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_WEBHOOK_DELAY_MS) {
    throw new ValidationError(`${field} must be an integer between 0 and ${MAX_WEBHOOK_DELAY_MS}`)
  }
  return value
}

function webhookDelay(value: unknown, field: string): void {
  if (value === undefined) return
  const shape = `${field} must be { type: "fixed", milliseconds } or { type: "uniform", lower, upper }`
  if (!isObject(value)) throw new ValidationError(shape)
  if (value.type === 'fixed') {
    delayMs(value.milliseconds, `${field}.milliseconds`)
  } else if (value.type === 'uniform') {
    const lower = delayMs(value.lower, `${field}.lower`)
    const upper = delayMs(value.upper, `${field}.upper`)
    if (lower > upper) throw new ValidationError(`${field}.lower must not be greater than upper`)
  } else {
    throw new ValidationError(shape)
  }
}

function webhook(parameters: unknown, field: string): void {
  if (!isObject(parameters)) throw new ValidationError(`${field} must be an object`)
  if (typeof parameters.method !== 'string' || !(WEBHOOK_METHODS as readonly string[]).includes(parameters.method)) {
    throw new ValidationError(`${field}.method must be one of ${WEBHOOK_METHODS.join(', ')}`)
  }
  httpUrl(parameters.url, `${field}.url`, { templated: true })
  stringMap(parameters.headers, `${field}.headers`)
  if (parameters.body !== undefined && typeof parameters.body !== 'string') throw new ValidationError(`${field}.body must be a string`)
  webhookDelay(parameters.delay, `${field}.delay`)
}

function proxy(response: Record<string, unknown>): void {
  const has = (k: string) => response[k] !== undefined
  if (!has('proxyBaseUrl')) return
  httpUrl(response.proxyBaseUrl, 'response.proxyBaseUrl')
  stringMap(response.additionalProxyRequestHeaders, 'response.additionalProxyRequestHeaders')
  const remove = response.removeProxyRequestHeaders
  if (remove !== undefined && (!Array.isArray(remove) || !remove.every((h) => typeof h === 'string'))) {
    throw new ValidationError('response.removeProxyRequestHeaders must be a list of header names')
  }
  const prefix = response.proxyUrlPrefixToRemove
  if (prefix !== undefined && (typeof prefix !== 'string' || !prefix.startsWith('/'))) {
    throw new ValidationError('response.proxyUrlPrefixToRemove must start with /')
  }
}

function scenario(stub: Record<string, unknown>): void {
  for (const field of ['scenarioName', 'requiredScenarioState', 'newScenarioState'] as const) {
    const v = stub[field]
    if (v !== undefined && (typeof v !== 'string' || v.trim() === '')) throw new ValidationError(`${field} must be a non-empty string`)
  }
  if (stub.scenarioName === undefined) {
    if (stub.requiredScenarioState !== undefined) throw new ValidationError('requiredScenarioState needs scenarioName')
    if (stub.newScenarioState !== undefined) throw new ValidationError('newScenarioState needs scenarioName')
  }
}

/** Throws a ValidationError naming the field when a proxy, webhook or scenario field is malformed. */
export function assertPowerFields(stub: { response: Record<string, unknown> } & Record<string, unknown>): void {
  proxy(stub.response)
  const listeners = stub.serveEventListeners
  if (listeners !== undefined) {
    if (!Array.isArray(listeners)) throw new ValidationError('serveEventListeners must be a list')
    listeners.forEach((listener: unknown, i) => {
      const field = `serveEventListeners[${i}]`
      if (!isObject(listener) || typeof listener.name !== 'string' || listener.name === '') {
        throw new ValidationError(`${field}.name must be a non-empty string`)
      }
      if (listener.name === 'webhook') webhook(listener.parameters, `${field}.parameters`)
    })
  }
  scenario(stub)
}

/**
 * WireMock 3.13.1 only removes proxy request headers listed in lower case (power-features.test.ts); header names
 * are case-insensitive, so the list is stored lower-cased.
 */
export function normaliseProxyHeaders(response: Record<string, unknown>): Record<string, unknown> {
  const remove = response.removeProxyRequestHeaders
  if (!Array.isArray(remove)) return response
  return { ...response, removeProxyRequestHeaders: remove.map((h) => (typeof h === 'string' ? h.toLowerCase() : h)) }
}
