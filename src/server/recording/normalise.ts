import type { StubMapping } from '../wiremock/types'
import type { ReviewItem } from './types'

/** Response headers a recorded stub must not replay: transport details, and WireMock's own per-response header. */
const DROPPED_HEADERS = new Set(['matched-stub-id', 'matched-stub-name', 'date', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'])

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isJsonType = (type: string | undefined) => type !== undefined && /^[^;]*[/+]json\s*(;|$)/i.test(type.trim())

/** UTF-8 text without control characters (other than tab and line breaks), or null for binary. */
function asText(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text) ? null : text
  } catch {
    return null
  }
}

/** A recorded query matcher as the quick form writes it: `{ hasExactly: [{ equalTo: v }] }` → `{ equalTo: v }`. */
function simpleQueryMatcher(matcher: unknown): unknown {
  if (!isRecord(matcher) || Object.keys(matcher).length !== 1 || !Array.isArray(matcher.hasExactly) || matcher.hasExactly.length !== 1) return matcher
  const only = matcher.hasExactly[0]
  return isRecord(only) && Object.keys(only).length === 1 && typeof only.equalTo === 'string' ? { equalTo: only.equalTo } : matcher
}

/** The values a recorded query matcher pins, for showing the request's URL. */
const queryValues = (matcher: unknown): string[] =>
  isRecord(matcher) && typeof matcher.equalTo === 'string'
    ? [matcher.equalTo]
    : isRecord(matcher) && Array.isArray(matcher.hasExactly)
      ? matcher.hasExactly.flatMap((m) => (isRecord(m) && typeof m.equalTo === 'string' ? [m.equalTo] : []))
      : []

/**
 * WireMock records a request without a query as `url` and one with a query as `urlPath` + `queryParameters`
 * (`hasExactly` lists; pinned). Both become the quick form's shape: `urlPath` and single `equalTo` parameters.
 */
function requestOf(recorded: Record<string, unknown>): { request: Record<string, unknown>; url: string; path: string } {
  const { url: rawUrl, urlPath, queryParameters, method, bodyPatterns, ...rest } = recorded
  const request: Record<string, unknown> = { method }
  let url: string
  let path: string
  if (typeof urlPath === 'string') {
    path = urlPath
    request.urlPath = urlPath
    const query = new URLSearchParams()
    if (isRecord(queryParameters)) {
      request.queryParameters = Object.fromEntries(Object.entries(queryParameters).map(([name, m]) => [name, simpleQueryMatcher(m)]))
      for (const [name, m] of Object.entries(queryParameters)) for (const v of queryValues(m)) query.append(name, v)
    }
    url = query.size > 0 ? `${path}?${query}` : path
  } else {
    url = typeof rawUrl === 'string' ? rawUrl : '/'
    path = url.split('?')[0]
    if (url.includes('?')) request.url = url
    else request.urlPath = url
    if (queryParameters !== undefined) request.queryParameters = queryParameters
  }
  Object.assign(request, rest)
  if (Array.isArray(bodyPatterns)) {
    // WireMock records { equalToJson, ignoreArrayOrder, ignoreExtraElements }; the quick form matches without
    // ignoreArrayOrder. The recorded body still matches itself, so dropping it keeps the mock answering.
    request.bodyPatterns = bodyPatterns.map((p) => {
      if (!isRecord(p) || typeof p.equalToJson !== 'string' || p.ignoreExtraElements !== true) return p
      const { ignoreArrayOrder: _drop, ...kept } = p
      return kept
    })
  }
  return { request, url, path }
}

/**
 * A stub WireMock recorded, turned into a review list entry: the shape the quick URL form reads back where it can
 * (urlPath + query parameters, inline text or JSON bodies), transport headers dropped. `matchedStubId` is the
 * WireMock stub that answered (the recorded `Matched-Stub-Id` header) and helps spot duplicates.
 */
export function reviewItem(recorded: StubMapping): ReviewItem & { matchedStubId?: string } {
  const { id, uuid: _uuid, name: _name, persistent: _persistent, metadata: _metadata, request: rawRequest, response: rawResponse, ...extra } = recorded
  const { request, url, path } = requestOf(rawRequest)
  const response: Record<string, unknown> = { ...rawResponse }
  let matchedStubId: string | undefined
  let contentType: string | undefined
  if (isRecord(response.headers)) {
    const kept: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(response.headers)) {
      const lower = name.toLowerCase()
      if (lower === 'matched-stub-id' && typeof value === 'string') matchedStubId = value
      if (DROPPED_HEADERS.has(lower)) continue
      if (lower === 'content-type' && typeof value === 'string') contentType = value
      kept[name] = value
    }
    if (Object.keys(kept).length > 0) response.headers = kept
    else delete response.headers
  }

  let bodySize = 0
  if (typeof response.base64Body === 'string') {
    const bytes = Buffer.from(response.base64Body, 'base64')
    bodySize = bytes.length
    const text = asText(bytes)
    if (text !== null) {
      delete response.base64Body
      response.body = text
    } else if (contentType === undefined) {
      contentType = 'application/octet-stream'
      response.headers = { ...(response.headers as Record<string, unknown> | undefined), 'Content-Type': contentType }
    }
  } else if (typeof response.body === 'string') bodySize = Buffer.byteLength(response.body)
  if (response.body === '') delete response.body
  if (typeof response.body === 'string' && isJsonType(contentType)) {
    try {
      response.jsonBody = JSON.parse(response.body)
      delete response.body
    } catch {
      // Not JSON after all: keep the text.
    }
  }
  // Header order as WireMock sends: body fields after status and headers.
  const { status, headers, ...body } = response
  const ordered = { status, ...(headers !== undefined ? { headers } : {}), ...body }

  const method = typeof request.method === 'string' ? request.method : 'ANY'
  return {
    id,
    stub: { name: `${method} ${path}`, request, response: ordered, ...extra },
    method,
    url,
    status: typeof status === 'number' ? status : null,
    bodySize,
    ...(contentType !== undefined ? { contentType } : {}),
    ...(matchedStubId !== undefined ? { matchedStubId } : {}),
  }
}
