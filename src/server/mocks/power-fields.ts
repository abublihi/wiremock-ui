import { ValidationError } from '../errors'

/**
 * Field rules for proxying (response.proxyBaseUrl …), webhooks (serveEventListeners) and scenarios, in WireMock
 * 3.13.1's own shapes. Webhook targets are not filtered: WireMock calls them from inside the user's test
 * environment, so pointing one at WireMock itself or at this UI is allowed.
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The form offers these; any RFC 9110 method token is accepted (and stored upper-cased), as WireMock does. */
export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
export const MAX_WEBHOOK_DELAY_MS = 600_000

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
  const shape = `${field} must be { type: "fixed", milliseconds }, { type: "uniform", lower, upper } or { type: "lognormal", median, sigma }`
  if (!isObject(value)) throw new ValidationError(shape)
  if (value.type === 'fixed') {
    delayMs(value.milliseconds, `${field}.milliseconds`)
  } else if (value.type === 'uniform') {
    const lower = delayMs(value.lower, `${field}.lower`)
    const upper = delayMs(value.upper, `${field}.upper`)
    if (lower > upper) throw new ValidationError(`${field}.lower must not be greater than upper`)
  } else if (value.type === 'lognormal') {
    delayMs(value.median, `${field}.median`)
    if (typeof value.sigma !== 'number' || !Number.isFinite(value.sigma) || value.sigma < 0) {
      throw new ValidationError(`${field}.sigma must be a number of 0 or more`)
    }
    if (value.maxValue !== undefined) delayMs(value.maxValue, `${field}.maxValue`)
  } else {
    throw new ValidationError(shape)
  }
}

function webhook(parameters: unknown, field: string): void {
  if (!isObject(parameters)) throw new ValidationError(`${field} must be an object`)
  if (typeof parameters.method !== 'string' || !METHOD_TOKEN.test(parameters.method)) {
    throw new ValidationError(`${field}.method must be an HTTP method such as ${WEBHOOK_METHODS.join(', ')}`)
  }
  httpUrl(parameters.url, `${field}.url`, { templated: true })
  stringMap(parameters.headers, `${field}.headers`)
  if (parameters.body !== undefined && typeof parameters.body !== 'string') throw new ValidationError(`${field}.body must be a string`)
  webhookDelay(parameters.delay, `${field}.delay`)
}

function proxy(response: Record<string, unknown>): void {
  if (response.proxyBaseUrl !== undefined) httpUrl(response.proxyBaseUrl, 'response.proxyBaseUrl')
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
 * Stored forms WireMock 3.13.1 needs: it only removes proxy request headers listed in lower case
 * (power-features.test.ts), and header names are case-insensitive, so that list is lower-cased; webhook methods
 * are upper-cased. Call after assertPowerFields.
 */
export function normalisePowerFields<T extends { response: Record<string, unknown> } & Record<string, unknown>>(stub: T): T {
  let out = stub
  const remove = stub.response.removeProxyRequestHeaders
  if (Array.isArray(remove)) {
    out = { ...out, response: { ...out.response, removeProxyRequestHeaders: remove.map((h) => (typeof h === 'string' ? h.toLowerCase() : h)) } }
  }
  const listeners = stub.serveEventListeners
  if (Array.isArray(listeners)) {
    out = {
      ...out,
      serveEventListeners: listeners.map((l: unknown) =>
        isObject(l) && l.name === 'webhook' && isObject(l.parameters) && typeof l.parameters.method === 'string'
          ? { ...l, parameters: { ...l.parameters, method: l.parameters.method.toUpperCase() } }
          : l,
      ),
    }
  }
  return out
}
