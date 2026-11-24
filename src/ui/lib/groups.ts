import type { GroupBy, GroupInput } from '@/server/mocks/groups'
import { DEFAULT_PRIORITY, FALLBACK_STEP, groupOf, templateVariables } from '@/server/mocks/groups'
import { tagsOf } from '@/server/mocks/tags'
import type { StubMapping } from '@/server/wiremock/types'
import { type HeaderRow, type QuickRequest, type SimpleForm, headerMap, isJsonContentType, readQuickRequest } from './editor-sync'

/**
 * The editor of a mock with several responses ("When seq = 1 → …"): its form, read from the group's stubs and
 * turned into the server's GroupInput. Keep in step with src/server/mocks/groups.ts (what it builds is what we read).
 */

/** How the deciding value is named in sentences ("When {by} = 1"). */
export function byLabel(by: GroupBy): string {
  return by.location === 'query' ? `?${by.expression}` : by.expression
}

/** One response as the form edits it: everything as typed. */
export type ResponseForm = {
  status: string
  /** Response headers, Content-Type included. */
  headers: HeaderRow[]
  body: string
  /** Delay in milliseconds ('' for none). */
  delayMs: string
}

export type GroupRow = { key: string; value: string; response: ResponseForm }

export type GroupForm = {
  name: string
  tags: string[]
  /** The request every response shares (method, URL, query and body to match, priority). */
  quick: Omit<QuickRequest, 'responseHeaders'>
  by: GroupBy
  rows: GroupRow[]
  /** "Any other value": a response, or none (WireMock tries other mocks, then answers 404). */
  fallback: { on: boolean; response: ResponseForm }
}

let nextKey = 0
export const rowKey = () => `r${++nextKey}`

export const emptyResponse = (): ResponseForm => ({ status: '200', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '', delayMs: '' })

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A response the form can show (status, string headers, a text or JSON body, a fixed delay), else null. */
function readResponse(response: Record<string, unknown>): ResponseForm | null {
  const allowed = ['status', 'headers', 'body', 'jsonBody', 'fixedDelayMilliseconds']
  if (!Object.keys(response).every((k) => allowed.includes(k))) return null
  if (typeof response.status !== 'number') return null
  const headers = response.headers ?? {}
  if (!isRecord(headers) || !Object.values(headers).every((v) => typeof v === 'string')) return null
  const delay = response.fixedDelayMilliseconds
  if (delay !== undefined && (typeof delay !== 'number' || !Number.isInteger(delay) || delay < 0)) return null
  if ('body' in response && 'jsonBody' in response) return null
  let body = ''
  if (response.jsonBody !== undefined) body = JSON.stringify(response.jsonBody, null, 2)
  else if (response.body !== undefined) {
    if (typeof response.body !== 'string') return null
    body = response.body
  }
  return {
    status: String(response.status),
    headers: Object.entries(headers as Record<string, string>).map(([name, value]) => ({ name, value })),
    body,
    delayMs: delay === undefined ? '' : String(delay),
  }
}

/** The request without the value's matcher (what every response shares), or null when the matcher is not there as built. */
function withoutKey(request: Record<string, unknown>, by: GroupBy, value: string | undefined): Record<string, unknown> | null {
  const out = { ...request }
  if (value === undefined) return out
  const drop = (field: string) => {
    const map = out[field]
    if (!isRecord(map) || !isRecord(map[by.expression]) || (map[by.expression] as Record<string, unknown>).equalTo !== value) return false
    const { [by.expression]: _gone, ...rest } = map
    if (Object.keys(rest).length > 0) out[field] = rest
    else delete out[field]
    return true
  }
  switch (by.location) {
    case 'path':
      return drop('pathParameters') ? out : null
    case 'query':
      return drop('queryParameters') ? out : null
    case 'header':
      return drop('headers') ? out : null
    case 'form':
      return drop('formParameters') ? out : null
    default: {
      const key = by.location === 'jsonPath' ? 'matchesJsonPath' : 'matchesXPath'
      const patterns = out.bodyPatterns
      if (!Array.isArray(patterns) || patterns.length !== 1) return null
      const p = patterns[0]
      if (!isRecord(p) || !isRecord(p[key])) return null
      const m = p[key] as Record<string, unknown>
      if (m.expression !== by.expression || m.equalTo !== value) return null
      delete out.bodyPatterns
      return out
    }
  }
}

/**
 * The form for a group's stubs (in editor order, the fallback last), or null when they hold anything the form cannot
 * show; the page then offers each response in the JSON editor.
 */
export function groupFormFromStubs(stubs: StubMapping[]): GroupForm | null {
  const first = stubs[0]
  const meta = first && groupOf(first)
  if (!first || !meta) return null
  let quick: Omit<QuickRequest, 'responseHeaders' | 'priority'> | null = null
  const rows: GroupRow[] = []
  let fallback: GroupForm['fallback'] = { on: false, response: emptyResponse() }
  let priority: number | undefined
  for (const stub of stubs) {
    const g = groupOf(stub)
    if (!g || g.id !== meta.id || g.by.location !== meta.by.location || g.by.expression !== meta.by.expression) return null
    const allowed = ['id', 'uuid', 'name', 'priority', 'persistent', 'request', 'response', 'metadata']
    if (!Object.keys(stub).every((k) => allowed.includes(k))) return null
    if (!isRecord(stub.request) || !isRecord(stub.response)) return null
    const base = withoutKey(stub.request, meta.by, g.value)
    const read = base && readQuickRequest(base)
    if (!read) return null
    // Every response shares one request (but its value).
    if (quick && JSON.stringify(quick) !== JSON.stringify(read)) return null
    const response = readResponse(stub.response)
    if (!response) return null
    if (g.value === undefined) {
      fallback = { on: true, response }
    } else {
      const p = typeof stub.priority === 'number' ? stub.priority : undefined
      if (rows.length > 0 && p !== priority) return null
      priority = p
      rows.push({ key: rowKey(), value: g.value, response })
    }
    quick ??= read
  }
  if (!quick || rows.length === 0) return null
  return {
    name: typeof first.name === 'string' ? first.name : '',
    tags: tagsOf(first),
    quick: { ...quick, priority: priority === undefined ? '' : String(priority) },
    by: meta.by,
    rows,
    fallback,
  }
}

/** A response as the server's builder takes it (a JSON Content-Type sends the body as JSON). */
function responseInput(r: ResponseForm) {
  const headers = headerMap(r.headers)
  const delay = r.delayMs.trim()
  return {
    status: Number(r.status),
    ...(headers ? { headers } : {}),
    ...(r.body !== '' ? { body: r.body } : {}),
    ...(delay !== '' ? { delayMs: Number(delay) } : {}),
  }
}

export function groupInput(form: GroupForm): GroupInput {
  const q = form.quick
  const query = headerMap(q.query)
  const priority = q.priority.trim()
  return {
    ...(form.name.trim() !== '' ? { name: form.name.trim() } : {}),
    ...(form.tags.length > 0 ? { tags: form.tags } : {}),
    ...(priority !== '' ? { priority: Number(priority) } : {}),
    request: {
      method: q.method,
      urlType: q.urlType,
      url: q.url.trim(),
      ...(query ? { query } : {}),
      ...(q.body.trim() !== '' ? { body: q.body } : {}),
    },
    by: { location: form.by.location, expression: form.by.expression.trim() },
    responses: form.rows.map((r) => ({ value: r.value, response: responseInput(r.response) })),
    fallback: form.fallback.on ? { response: responseInput(form.fallback.response) } : null,
  }
}

/** The checks the form makes before sending (the server makes them too); keys are row keys, `by`, `fallback`. */
export function groupProblems(form: GroupForm): Record<string, string> {
  const out: Record<string, string> = {}
  const expression = form.by.expression.trim()
  if (expression === '') out.by = 'byRequired'
  else if (form.by.location === 'path' && (form.quick.urlType !== 'template' || !templateVariables(form.quick.url).includes(expression))) out.by = 'byPathMissing'
  const seen = new Set<string>()
  for (const row of form.rows) {
    if (row.value === '') out[row.key] = 'valueRequired'
    else if (seen.has(row.value)) out[row.key] = 'valueTwice'
    else out[row.key] = responseProblem(row.response) ?? ''
    seen.add(row.value)
    if (out[row.key] === '') delete out[row.key]
  }
  if (form.fallback.on) {
    const p = responseProblem(form.fallback.response)
    if (p) out.fallback = p
  }
  return out
}

function responseProblem(r: ResponseForm): string | undefined {
  const status = Number(r.status)
  if (!/^\d+$/.test(r.status) || status < 100 || status > 599) return 'statusRange'
  if (r.delayMs.trim() !== '' && (!/^\d+$/.test(r.delayMs.trim()) || Number(r.delayMs) > 120000)) return 'delayRange'
  const type = r.headers.find((h) => h.name.trim().toLowerCase() === 'content-type')?.value
  if (r.body !== '' && isJsonContentType(type)) {
    try {
      JSON.parse(r.body)
    } catch {
      return 'bodyJson'
    }
  }
  return undefined
}

/** Which response answers `value` ("Try it"): a row, the fallback, or nothing from this mock. */
export function answerFor(form: GroupForm, value: string): { kind: 'row'; row: GroupRow } | { kind: 'fallback' } | { kind: 'none' } {
  const row = form.rows.find((r) => r.value !== '' && r.value === value)
  if (row) return { kind: 'row', row }
  return form.fallback.on ? { kind: 'fallback' } : { kind: 'none' }
}

/** The "Answer differently by" a URL suggests: its last template variable, else a query parameter to name. */
export function suggestBy(quick: Pick<QuickRequest, 'urlType' | 'url'>): GroupBy {
  const vars = quick.urlType === 'template' ? templateVariables(quick.url) : []
  return vars.length > 0 ? { location: 'path', expression: vars.at(-1)! } : { location: 'query', expression: '' }
}

/** A new group from a single mock's Simple form: its request, its response as the first row (value to fill in). */
export function groupFormFromSimple(form: SimpleForm, tags: string[]): GroupForm | null {
  const quick = form.quick
  if (!quick || form.answer === 'proxy' || form.fault !== '' || form.binary) return null
  const { responseHeaders, ...request } = quick
  const by = suggestBy(quick)
  return {
    name: form.name,
    tags,
    quick: request,
    by,
    rows: [
      {
        key: rowKey(),
        value: '',
        response: { status: String(form.status), headers: responseHeaders, body: form.body, delayMs: form.slow ? String(form.delaySeconds * 1000) : '' },
      },
    ],
    fallback: { on: false, response: { ...emptyResponse(), status: '404' } },
  }
}

/** The fallback's priority as the server will write it. */
export const fallbackPriority = (form: GroupForm) => (form.quick.priority.trim() === '' ? DEFAULT_PRIORITY : Number(form.quick.priority)) + FALLBACK_STEP
