import type { Endpoint, Integration } from '@/server/catalog/types'
import type { LoggedEvent, StubMapping } from '@/server/wiremock/types'

/** A name/value row (query parameter or header); names may repeat. */
export type Pair = { name: string; value: string }

/** A request to send to WireMock (test panel) or to print as curl. `path` has no query string. */
export type RequestDraft = { method: string; path: string; query: Pair[]; headers: Pair[]; body: string }

/** A draft built from a mock. `pathIsPattern`: the mock matches a regex no sample could fill, so `path` is that regex. */
export type StubDraft = { draft: RequestDraft; pathIsPattern: boolean }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const EXAMPLE = 'example'

/** UTF-8 text as base64 (btoa alone only takes Latin-1). */
const base64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

/** Splits `/a?x=1` into its path and decoded query pairs. */
export function splitUrl(url: string): { path: string; query: Pair[] } {
  const at = url.indexOf('?')
  if (at < 0) return { path: url || '/', query: [] }
  const query = [...new URLSearchParams(url.slice(at + 1))].map(([name, value]) => ({ name, value }))
  return { path: url.slice(0, at) || '/', query }
}

// ── Regex paths ──────────────────────────────────────────────────────────────

// Common "any segment" pieces, most specific first, with what to put in their place.
const PIECES: [RegExp, string][] = [
  [/\\d\{(\d+)\}/g, '1'],
  [/\[0-9\]\{(\d+)\}/g, '1'],
  [/(\\d|\[0-9\])[+*]/g, '1'],
  [/\[\^\/\][+*]/g, EXAMPLE],
  [/\[[A-Za-z0-9_\\w-]+\][+*]/g, EXAMPLE],
  [/\\w[+*]/g, EXAMPLE],
  [/\.[+*]\??/g, EXAMPLE],
]
const META = /[[\](){}*+?|^$\\]/

/**
 * A concrete path that the regex matches, for the common shapes (`\d+`, `[^/]+`, `.*`, escaped dots…), or null.
 * The result is always checked against the pattern itself.
 */
export function samplePath(pattern: string): string | null {
  let s = pattern.replace(/^\^/, '').replace(/\$$/, '')
  for (const [piece, value] of PIECES) {
    s = s.replace(piece, (_m, count?: string) => (value === '1' && count && /^\d+$/.test(count) ? '1'.repeat(Number(count)) : value))
  }
  s = s.replace(/\\([^A-Za-z0-9])/g, '$1')
  if (META.test(s) || !s.startsWith('/')) return null
  try {
    return new RegExp(`^(?:${pattern.replace(/^\^/, '').replace(/\$$/, '')})$`).test(s) ? s : null
  } catch {
    return null
  }
}

// ── Matchers ─────────────────────────────────────────────────────────────────

/** A value that satisfies a WireMock string matcher, or undefined for "absent"/"doesn't match"-style matchers. */
function valueFor(matcher: unknown): string | undefined {
  if (typeof matcher === 'string') return matcher
  if (!isRecord(matcher)) return undefined
  for (const op of ['equalTo', 'equalToIgnoreCase', 'contains', 'equalToNumber', 'equalToDateTime'] as const) {
    if (matcher[op] !== undefined) return String(matcher[op])
  }
  if (typeof matcher.matches === 'string') return samplePath(`/${matcher.matches}`)?.slice(1) ?? EXAMPLE
  for (const op of ['hasExactly', 'includes'] as const) {
    if (Array.isArray(matcher[op]) && matcher[op].length > 0) return valueFor(matcher[op][0])
  }
  if (matcher.absent === true || matcher.doesNotMatch !== undefined || matcher.doesNotContain !== undefined) return undefined
  return EXAMPLE
}

function pairsFrom(matchers: unknown): Pair[] {
  if (!isRecord(matchers)) return []
  const pairs: Pair[] = []
  for (const [name, matcher] of Object.entries(matchers)) {
    const value = valueFor(matcher)
    if (value !== undefined) pairs.push({ name, value })
  }
  return pairs
}

// ── Bodies ───────────────────────────────────────────────────────────────────

const SIMPLE_JSONPATH = /^\$((?:\.[A-Za-z_$][\w$-]*)+)$/

/** Sets `value` at a dotted JSONPath (`$.a.b`) in a JSON object text; undefined when it can't. */
function setJsonPath(text: string, expression: string, value: string): string | undefined {
  const m = SIMPLE_JSONPATH.exec(expression.trim())
  if (!m) return undefined
  let root: unknown = {}
  if (text.trim()) {
    try {
      root = JSON.parse(text)
    } catch {
      return undefined
    }
  }
  if (!isRecord(root)) return undefined
  const keys = m[1]!.slice(1).split('.')
  let node: Record<string, unknown> = root
  for (const key of keys.slice(0, -1)) {
    if (!isRecord(node[key])) node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[keys[keys.length - 1]!] = value
  return JSON.stringify(root, null, 2)
}

const SIMPLE_XPATH = /^\/\/?([A-Za-z_][\w.-]*)(?:\/([A-Za-z_][\w.-]*))*$/
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeRegex = (s: string) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')

/** Sets the text of the element a simple XPath (`/a/b`, `//b`) names; undefined when it can't. */
function setXPath(text: string, expression: string, value: string): string | undefined {
  const expr = expression.trim()
  if (!SIMPLE_XPATH.test(expr)) return undefined
  const steps = expr.split('/').filter(Boolean)
  const leaf = steps[steps.length - 1]!
  if (text.trim()) {
    const element = new RegExp(`(<${escapeRegex(leaf)}(?:\\s[^>]*)?>)[^<]*(</${escapeRegex(leaf)}>)`)
    return element.test(text) ? text.replace(element, (_m, open: string, close: string) => `${open}${escapeXml(value)}${close}`) : undefined
  }
  return steps.reduceRight((inner, step) => `<${step}>${inner}</${step}>`, escapeXml(value))
}

const formEncode = (pairs: Pair[]) => pairs.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&')

/** The body that satisfies the stub's body patterns, starting from the catalog example. */
function bodyFor(patterns: unknown, example: string): string {
  let body = example
  if (!Array.isArray(patterns)) return body
  for (const pattern of patterns) {
    if (!isRecord(pattern)) continue
    if (pattern.equalToJson !== undefined) {
      body = typeof pattern.equalToJson === 'string' ? pattern.equalToJson : JSON.stringify(pattern.equalToJson, null, 2)
    } else if (typeof pattern.equalTo === 'string') body = pattern.equalTo
    else if (typeof pattern.equalToXml === 'string') body = pattern.equalToXml
    else if (typeof pattern.contains === 'string' && !body.includes(pattern.contains)) body = pattern.contains
    else if (isRecord(pattern.matchesJsonPath)) {
      const { expression, ...matcher } = pattern.matchesJsonPath
      const value = valueFor(matcher)
      if (typeof expression === 'string' && value !== undefined) body = setJsonPath(body, expression, value) ?? body
    } else if (isRecord(pattern.matchesXPath)) {
      const { expression, ...matcher } = pattern.matchesXPath
      const value = valueFor(matcher)
      if (typeof expression === 'string' && value !== undefined) body = setXPath(body, expression, value) ?? body
    }
  }
  return body
}

/** The Content-Type a body most likely needs. */
function contentTypeOf(body: string): string {
  const text = body.trim()
  if (text.startsWith('<')) return 'application/xml'
  try {
    JSON.parse(text)
    return 'application/json'
  } catch {
    return 'text/plain'
  }
}

const hasHeader = (headers: Pair[], name: string) => headers.some((h) => h.name.toLowerCase() === name.toLowerCase())

// ── Stub → draft ─────────────────────────────────────────────────────────────

function pathFor(request: Record<string, unknown>): { path: string; query: Pair[]; pathIsPattern: boolean } {
  if (typeof request.url === 'string') return { ...splitUrl(request.url), pathIsPattern: false }
  if (typeof request.urlPath === 'string') return { path: request.urlPath, query: [], pathIsPattern: false }
  if (typeof request.urlPathTemplate === 'string') {
    const params = isRecord(request.pathParameters) ? request.pathParameters : {}
    const path = request.urlPathTemplate.replace(/\{([^}]+)\}/g, (_m, name: string) => encodeURIComponent(valueFor(params[name]) ?? EXAMPLE))
    return { path, query: [], pathIsPattern: false }
  }
  const pattern = typeof request.urlPathPattern === 'string' ? request.urlPathPattern : typeof request.urlPattern === 'string' ? request.urlPattern : undefined
  if (pattern === undefined) return { path: '/', query: [], pathIsPattern: false }
  const sample = samplePath(pattern)
  if (sample) return { ...splitUrl(sample), pathIsPattern: false }
  return { path: pattern, query: [], pathIsPattern: true }
}

/**
 * A request that this mock would match: method (ANY → GET), a concrete path (template parameters from the
 * mock's path matchers or `example`; a regex filled from a sample when one matches), query, headers, cookies,
 * basic auth, and a body — the catalog example request with the key set where the mock looks for it.
 */
export function draftFromStub(stub: Pick<StubMapping, 'request'>, endpoint?: Pick<Endpoint, 'exampleRequest'>): StubDraft {
  const request = isRecord(stub.request) ? stub.request : {}
  const method = typeof request.method === 'string' && request.method !== 'ANY' ? request.method.toUpperCase() : 'GET'
  const { path, query, pathIsPattern } = pathFor(request)
  query.push(...pairsFrom(request.queryParameters))

  const headers = pairsFrom(request.headers)
  const cookies = pairsFrom(request.cookies)
  if (cookies.length > 0) headers.push({ name: 'Cookie', value: cookies.map((c) => `${c.name}=${c.value}`).join('; ') })
  const auth = request.basicAuthCredentials
  if (isRecord(auth) && typeof auth.username === 'string' && typeof auth.password === 'string') {
    headers.push({ name: 'Authorization', value: `Basic ${base64(`${auth.username}:${auth.password}`)}` })
  }

  const example = endpoint?.exampleRequest ?? ''
  const form = pairsFrom(request.formParameters)
  let body: string
  let type: string | undefined
  if (form.length > 0) {
    body = formEncode(form)
    type = 'application/x-www-form-urlencoded'
  } else {
    body = bodyFor(request.bodyPatterns, example)
    type = body.trim() ? contentTypeOf(body) : undefined
  }

  // A Content-Type matcher that isn't an exact value (contains "json", say) gives way to the type the body needs.
  const ct = headers.findIndex((h) => h.name.toLowerCase() === 'content-type')
  const exact = isRecord(request.headers) && Object.entries(request.headers).some(([n, m]) => n.toLowerCase() === 'content-type' && isRecord(m) && m.equalTo !== undefined)
  if (ct >= 0 && !exact && type) headers[ct] = { name: headers[ct]!.name, value: type }
  else if (type && !hasHeader(headers, 'content-type')) headers.push({ name: 'Content-Type', value: type })

  return { draft: { method, path, query, headers, body }, pathIsPattern }
}

// ── Logged request → draft ───────────────────────────────────────────────────

/** Headers a replay must not copy: the transport sets them (and the relay would drop them anyway). */
const TRANSPORT_HEADERS = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'expect', 'upgrade', 'accept-encoding'])

/** Header values as WireMock logs them: a string, a list, or `{ values: [...] }`. */
function headerValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(headerValues)
  if (isRecord(value) && 'values' in value) return headerValues(value.values)
  return value === undefined || value === null ? [] : [String(value)]
}

/** A logged request's headers in order, one pair per value, without the transport's own headers. */
export function loggedHeaders(event: Pick<LoggedEvent, 'request'>): Pair[] {
  const pairs: Pair[] = []
  for (const [name, value] of Object.entries(event.request.headers ?? {})) {
    if (TRANSPORT_HEADERS.has(name.toLowerCase())) continue
    for (const v of headerValues(value)) pairs.push({ name, value: v })
  }
  return pairs
}

/** A logged request as an editable draft (for Resend). */
export function draftFromLoggedRequest(event: Pick<LoggedEvent, 'request'>): RequestDraft {
  const { path, query } = splitUrl(event.request.url)
  return { method: (event.request.method || 'GET').toUpperCase(), path, query, headers: loggedHeaders(event), body: event.request.body ?? '' }
}

// ── Catalog endpoint → draft ─────────────────────────────────────────────────

const CONTENT_TYPES: Record<Endpoint['contentType'], string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  html: 'text/html',
}

/**
 * The request "Try it" sends for a catalog endpoint: its method (ANY → GET), the integration prefix + path
 * (template variables and regex pieces filled with a sample), the example request as the body, and a query
 * parameter or header named by the key lookup (value `example`) so the shape is right.
 */
export function draftFromEndpoint(
  integration: Pick<Integration, 'prefix'>,
  endpoint: Pick<Endpoint, 'method' | 'path' | 'pathType' | 'lookup' | 'contentType' | 'exampleRequest'>,
): StubDraft {
  const url = (integration.prefix === '/' ? '' : integration.prefix) + endpoint.path
  const pathKey = endpoint.pathType === 'template' ? 'urlPathTemplate' : endpoint.pathType === 'regex' ? 'urlPathPattern' : 'urlPath'
  const request: Record<string, unknown> = { method: endpoint.method, [pathKey]: url }
  const lookup = endpoint.lookup
  if (lookup?.location === 'query') request.queryParameters = { [lookup.expression]: { equalTo: EXAMPLE } }
  if (lookup?.location === 'header') request.headers = { [lookup.expression]: { equalTo: EXAMPLE } }
  if (lookup?.location === 'form' && !endpoint.exampleRequest?.trim()) request.formParameters = { [lookup.expression]: { equalTo: EXAMPLE } }
  const { draft, pathIsPattern } = draftFromStub({ request } as Pick<StubMapping, 'request'>, endpoint)
  // The catalog knows the body's type better than a guess from its first character.
  const ct = draft.headers.findIndex((h) => h.name.toLowerCase() === 'content-type')
  if (ct >= 0 && draft.body.trim() && lookup?.location !== 'form') draft.headers[ct] = { name: 'Content-Type', value: CONTENT_TYPES[endpoint.contentType] }
  return { draft, pathIsPattern }
}
