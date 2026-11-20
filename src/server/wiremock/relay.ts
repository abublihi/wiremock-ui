import { z } from 'zod'
import { AppError, ValidationError } from '../errors'

/**
 * Rules for the test-request relay (POST /api/test-request). The relay may only reach WireMock's stub port at
 * WIREMOCK_URL: never another host, never the admin API, never with smuggled headers. Pure functions, so the
 * refusals are unit-tested without a network.
 */

export const RELAY_MAX_BODY_BYTES = 1024 * 1024
export const RELAY_TIMEOUT_MS = 30_000
export const RELAY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export type RelayQuery = string | Record<string, string | string[]>

export type TestRequestInput = {
  method: (typeof RELAY_METHODS)[number]
  path: string
  query?: RelayQuery
  headers?: Record<string, string>
  body?: string
}

export type TestRequestResult = {
  status: number
  headers: Record<string, string>
  body: string
  bodyIsBase64: boolean
  /** True when the response body was longer than 1 MB and was cut there. */
  bodyTruncated: boolean
  durationMs: number
  matchedStubId: string | null
}

class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(message, 413)
  }
}

const schema = z.object(
  {
    method: z
      .string({ error: 'method is required' })
      .transform((m) => m.toUpperCase())
      .pipe(z.enum(RELAY_METHODS, { error: `method must be one of ${RELAY_METHODS.join(', ')}` })),
    path: z.string({ error: 'path is required' }),
    query: z
      .union([z.string(), z.record(z.string(), z.union([z.string(), z.array(z.string())]))], {
        error: 'query must be a string or an object of strings',
      })
      .optional(),
    headers: z.record(z.string(), z.string(), { error: 'headers must be an object of strings' }).optional(),
    body: z.string({ error: 'body must be a string' }).optional(),
  },
  { error: 'body must be an object' },
)

export function parseTestRequest(raw: unknown): TestRequestInput {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue.path.map(String).join('.')
    throw new ValidationError(field && !issue.message.startsWith(field.split('.')[0]) ? `${field}: ${issue.message}` : issue.message)
  }
  const input = result.data
  if (input.body !== undefined) {
    if (input.method === 'GET' || input.method === 'HEAD') throw new ValidationError(`body is not allowed on a ${input.method} request`)
    if (Buffer.byteLength(input.body, 'utf8') > RELAY_MAX_BODY_BYTES) throw new PayloadTooLargeError('body is larger than 1 MB')
  }
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as TestRequestInput
}

// Control characters (CR/LF/NUL/…), space and DEL can split a request line or a header.
const CONTROL_OR_SPACE = /[\u0000- \u007f]/
const ENCODED_SEPARATOR = /%(2f|5c)/i
const MAX_DECODE_ROUNDS = 5

function refusePath(reason: string): never {
  throw new ValidationError(`path ${reason}`)
}

/** Each decoding level of the path, outermost first. The first level must decode; deeper levels stop quietly. */
function decodingLevels(path: string): string[] {
  const levels = [path]
  let current = path
  for (let i = 0; i < MAX_DECODE_ROUNDS; i++) {
    let next: string
    try {
      next = decodeURIComponent(current)
    } catch {
      if (i === 0) refusePath('has malformed percent-encoding')
      break
    }
    if (next === current) break
    levels.push(next)
    current = next
  }
  return levels
}

/** True for `/__admin` and anything below it, however the servlet container might read the segment. */
function isAdminPath(path: string): boolean {
  const first = (path.split('/')[1] ?? '').split(';')[0].toLowerCase()
  return first === '__admin'
}

function assertStubPath(path: string): void {
  if (path === '' || !path.startsWith('/')) refusePath('must start with /')
  if (path.startsWith('//')) refusePath('must not start with // (absolute URLs are refused)')
  if (CONTROL_OR_SPACE.test(path)) refusePath('must not contain spaces or control characters (encode them, e.g. %20)')
  if (path.includes('\\')) refusePath('must not contain a backslash')
  if (path.includes('?')) refusePath('must not contain ? (send the query string in query)')
  if (path.includes('#')) refusePath('must not contain #')
  for (const level of decodingLevels(path)) {
    if (ENCODED_SEPARATOR.test(level)) refusePath('must not contain an encoded / or \\')
    if (level.includes('\\')) refusePath('must not contain a backslash')
    // `..;x` is a dot segment to Jetty, so matrix parameters are ignored when looking for dot segments.
    if (level.split('/').some((segment) => ['.', '..'].includes(segment.split(';')[0]))) {
      refusePath('must not contain . or .. segments')
    }
    if (isAdminPath(level)) refusePath("must not target WireMock's admin API (/__admin)")
  }
}

function queryString(query: RelayQuery | undefined): string {
  if (query === undefined) return ''
  if (typeof query === 'string') {
    const raw = query.startsWith('?') ? query.slice(1) : query
    if (CONTROL_OR_SPACE.test(raw) || raw.includes('#')) {
      throw new ValidationError('query must not contain spaces, control characters or # (encode them)')
    }
    return raw === '' ? '' : `?${raw}`
  }
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(name, v)
  }
  const s = params.toString()
  return s === '' ? '' : `?${s}`
}

/** The URL a test request goes to: always WIREMOCK_URL's origin and path prefix, never its admin API. */
export function relayTarget(baseUrl: string, path: string, query?: RelayQuery): URL {
  assertStubPath(path)
  const base = new URL(baseUrl)
  const prefix = base.pathname.replace(/\/+$/, '')
  const target = new URL(`${base.origin}${prefix}${path}${queryString(query)}`)
  // Belt and braces: whatever the URL parser made of it must still be WireMock's stub port.
  if (target.origin !== base.origin || target.username !== '' || target.password !== '') refusePath('must stay on WireMock')
  if (!target.pathname.startsWith(`${prefix}/`)) refusePath('must stay on WireMock')
  const rest = target.pathname.slice(prefix.length)
  if (decodingLevels(rest).some(isAdminPath)) refusePath("must not target WireMock's admin API (/__admin)")
  return target
}

// RFC 9110 token.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const BAD_VALUE = /[\r\n\u0000]/
/** Hop-by-hop headers (RFC 9110 §7.6.1) plus what the relay itself controls. */
const NOT_FORWARDED = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
  'host',
  'content-length',
])
const MAX_HEADERS = 100

/** Headers to forward: names and values checked, Host/Content-Length/hop-by-hop dropped. */
export function relayHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const entries = Object.entries(headers)
  if (entries.length > MAX_HEADERS) throw new ValidationError(`headers: at most ${MAX_HEADERS} headers`)
  const dropped = new Set(NOT_FORWARDED)
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw new ValidationError(`headers: "${name.replace(/[\r\n]/g, ' ')}" is not a valid header name`)
    if (BAD_VALUE.test(value)) throw new ValidationError(`headers.${name} must not contain line breaks or NUL`)
    // Headers named in Connection are hop-by-hop too.
    if (name.toLowerCase() === 'connection') {
      for (const listed of value.split(',')) if (listed.trim()) dropped.add(listed.trim().toLowerCase())
    }
  }
  return Object.fromEntries(entries.filter(([name]) => !dropped.has(name.toLowerCase())))
}

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql)\b|[a-z]+\/[^;]*\+(json|xml)\b)/i

/**
 * Text when the content type is textual (or absent — WireMock serves plain `body` stubs without one) and the
 * bytes are valid UTF-8; base64 otherwise. A truncated body may end mid-character, which is not an error.
 */
export function decodeRelayBody(bytes: Uint8Array, contentType: string | null, truncated: boolean): { body: string; bodyIsBase64: boolean } {
  const type = contentType?.trim() ?? ''
  if (type === '' || TEXTUAL.test(type)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated })
      if (type !== '' || !text.includes('\u0000')) return { body: text, bodyIsBase64: false }
    } catch {
      // not UTF-8: fall through to base64
    }
  }
  return { body: Buffer.from(bytes).toString('base64'), bodyIsBase64: true }
}

/** Reads at most `limit` bytes of a response body, cancelling the rest. */
export async function readLimited(res: Response, limit = RELAY_MAX_BODY_BYTES): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > limit) {
      chunks.push(value.subarray(0, limit - size))
      size = limit
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    size += value.byteLength
  }
  return { bytes: Buffer.concat(chunks), truncated }
}
