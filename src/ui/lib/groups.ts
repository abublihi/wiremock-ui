import type { GroupBy, GroupInput } from '@/server/mocks/groups'
import { DEFAULT_PRIORITY, FALLBACK_STEP, MAX_CONDITIONS, conditionLabel, groupOf, templateVariables } from '@/server/mocks/groups'
import type { StubMapping } from '@/server/wiremock/types'
import { type QuickRequest, type SimpleForm, fromQuickStub, toQuickInput } from './editor-sync'

/**
 * A mock's extra responses in the Simple editor ("When orderId = 2003 and X-Tenant = acme → 409"). The editor's
 * own form is the mock's request and its "every other request" response; each row adds a response for some values.
 * With rows the mock is saved as a group of stubs (src/server/mocks/groups.ts), without them as one plain stub.
 * Keep in step with the server's builder: what it builds is what `responsesFromStubs` reads.
 */

export { conditionLabel, MAX_CONDITIONS }

/** One extra response: a value per condition ('' for any value) and the response, edited like the main one. */
export type ResponseRow = {
  key: string
  values: string[]
  /** The response part is what counts; its request is the editor's (only its response headers are its own). */
  form: SimpleForm
  /** The saved stub this row was read from (Test and Advanced use it). */
  stubId?: string
}

export type Responses = {
  /** The conditions (empty until a row is added). */
  by: GroupBy[]
  rows: ResponseRow[]
  /** Whether the editor's own response answers every other request (off: "No answer", WireMock tries other mocks). */
  fallbackOn: boolean
  /** The saved stub of "every other request", when there is one. */
  fallbackStubId?: string
}

let nextKey = 0
export const rowKey = () => `r${++nextKey}`

export const noResponses = (): Responses => ({ by: [], rows: [], fallbackOn: true })

const sameRequest = (a: QuickRequest, b: QuickRequest) =>
  JSON.stringify({ ...a, responseHeaders: [] }) === JSON.stringify({ ...b, responseHeaders: [] })

/** The request without the values' matchers (what every response shares), or null when a matcher is not there as built. */
function withoutKeys(request: Record<string, unknown>, by: GroupBy[], values: (string | null)[]): Record<string, unknown> | null {
  const out = { ...request }
  let bodyPatterns = Array.isArray(out.bodyPatterns) ? [...(out.bodyPatterns as unknown[])] : undefined
  for (const [i, b] of by.entries()) {
    const value = values[i]
    if (value === null || value === undefined) continue
    const drop = (field: string) => {
      const map = out[field]
      if (!isRecord(map)) return false
      const name = Object.keys(map).find((k) => (b.location === 'header' ? k.toLowerCase() === b.expression.toLowerCase() : k === b.expression))
      if (name === undefined || !isRecord(map[name]) || (map[name] as Record<string, unknown>).equalTo !== value) return false
      const { [name]: _gone, ...rest } = map
      if (Object.keys(rest).length > 0) out[field] = rest
      else delete out[field]
      return true
    }
    const ok = (() => {
      switch (b.location) {
        case 'path':
          return drop('pathParameters')
        case 'query':
          return drop('queryParameters')
        case 'header':
          return drop('headers')
        case 'form':
          return drop('formParameters')
        default: {
          const key = b.location === 'jsonPath' ? 'matchesJsonPath' : 'matchesXPath'
          const at = (bodyPatterns ?? []).findIndex((p) => {
            if (!isRecord(p) || !isRecord(p[key])) return false
            const m = p[key] as Record<string, unknown>
            return m.expression === b.expression && m.equalTo === value
          })
          if (at === -1) return false
          bodyPatterns = bodyPatterns!.filter((_, j) => j !== at)
          return true
        }
      }
    })()
    if (!ok) return null
  }
  if (bodyPatterns !== undefined) {
    if (bodyPatterns.length > 0) out.bodyPatterns = bodyPatterns
    else delete out.bodyPatterns
  }
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The editor's form and responses for a group's stubs (in editor order, the fallback last), or null when they hold
 * anything the form cannot show (Advanced mode then edits each stub's JSON).
 */
export function responsesFromStubs(stubs: StubMapping[]): { form: SimpleForm; responses: Responses } | null {
  const meta = stubs[0] && groupOf(stubs[0])
  if (!meta) return null
  const by = meta.by
  // The shared priority: a response sits one lower (a higher number) per condition left at any value, the fallback
  // FALLBACK_STEP lower. Read from the first response; every stub must sit where the builder puts it.
  const firstRow = stubs.find((s) => groupOf(s)?.values !== undefined)
  if (!firstRow) return null
  const stepOf = (values: (string | null)[] | undefined) => (values === undefined ? FALLBACK_STEP : values.filter((v) => v === null).length)
  const firstStep = stepOf(groupOf(firstRow)!.values)
  const firstOwn = typeof firstRow.priority === 'number' ? firstRow.priority : undefined
  const base = firstStep === 0 ? firstOwn : firstOwn === undefined ? undefined : firstOwn - firstStep === DEFAULT_PRIORITY ? undefined : firstOwn - firstStep
  const expected = (step: number) => (step === 0 ? base : (base ?? DEFAULT_PRIORITY) + step)
  let shared: QuickRequest | null = null
  let fallback: { form: SimpleForm; id: string } | null = null
  const rows: ResponseRow[] = []
  for (const stub of stubs) {
    const g = groupOf(stub)
    if (!g || g.id !== meta.id || JSON.stringify(g.by) !== JSON.stringify(by)) return null
    if (!isRecord(stub.request)) return null
    const request = withoutKeys(stub.request, by, g.values ?? [])
    if (!request) return null
    const own = typeof stub.priority === 'number' ? stub.priority : undefined
    if (own !== expected(stepOf(g.values))) return null
    const { priority: _p, ...rest } = stub
    const form = fromQuickStub({ ...rest, ...(base !== undefined ? { priority: base } : {}), request } as StubMapping)
    if (!form || form.scenario.enabled) return null
    if (shared && !sameRequest(shared, form.quick!)) return null
    shared ??= form.quick!
    if (g.values === undefined) fallback = { form, id: stub.id }
    else rows.push({ key: rowKey(), values: g.values.map((v) => v ?? ''), form, stubId: stub.id })
  }
  if (rows.length === 0) return null
  const main = fallback?.form ?? structuredClone(rows[0]!.form)
  return {
    form: main,
    responses: { by, rows, fallbackOn: fallback !== null, ...(fallback ? { fallbackStubId: fallback.id } : {}) },
  }
}

/** A response as the server's group builder takes it, from a form (its request is the editor's). */
function responseInput(form: SimpleForm, request: QuickRequest): GroupInput['responses'][number]['response'] {
  const q = toQuickInput({ ...form, quick: { ...request, responseHeaders: form.quick!.responseHeaders } })
  const { request: _r, priority: _p, name: _n, tags: _t, scenario: _s, ...response } = q
  return response
}

/** What the editor sends to save a mock with responses (or, with no rows, to turn a group back into one mock). */
export function groupInputFrom(form: SimpleForm, tags: string[], responses: Responses): GroupInput {
  const q = toQuickInput(form)
  const request = form.quick!
  return {
    ...(q.name !== undefined ? { name: q.name } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(q.priority !== undefined ? { priority: q.priority } : {}),
    request: q.request,
    by: responses.by.map((b) => ({ location: b.location, expression: b.expression.trim() })),
    responses: responses.rows.map((r) => ({
      values: r.values.map((v) => (v.trim() === '' ? null : v)),
      response: responseInput(r.form, request),
    })),
    fallback: responses.fallbackOn || responses.rows.length === 0 ? { response: responseInput(form, request) } : null,
  }
}

export type ResponsesProblem = 'byRequired' | 'byPathMissing' | 'byTwice' | 'valueRequired' | 'valueTwice'

/** The checks the editor makes before saving (the server makes them too); keys are `by:<i>` and row keys. */
export function responsesProblems(quick: QuickRequest, responses: Responses): Record<string, ResponsesProblem> {
  const out: Record<string, ResponsesProblem> = {}
  if (responses.rows.length === 0) return out
  const vars = quick.urlType === 'template' ? templateVariables(quick.url) : []
  responses.by.forEach((b, i) => {
    const expression = b.expression.trim()
    const same = (o: GroupBy) =>
      o.location === b.location && (b.location === 'header' ? o.expression.trim().toLowerCase() === expression.toLowerCase() : o.expression.trim() === expression)
    if (expression === '') out[`by:${i}`] = 'byRequired'
    else if (b.location === 'path' && !vars.includes(expression)) out[`by:${i}`] = 'byPathMissing'
    else if (responses.by.slice(0, i).some(same)) out[`by:${i}`] = 'byTwice'
  })
  const seen = new Set<string>()
  for (const row of responses.rows) {
    const values = row.values.map((v) => v.trim())
    const key = JSON.stringify(values)
    if (values.every((v) => v === '')) out[row.key] = 'valueRequired'
    else if (seen.has(key)) out[row.key] = 'valueTwice'
    seen.add(key)
  }
  return out
}

/** The condition a URL suggests first: its last template variable, else a query parameter to name. */
export function suggestBy(quick: Pick<QuickRequest, 'urlType' | 'url'>, taken: GroupBy[] = []): GroupBy {
  const vars = quick.urlType === 'template' ? templateVariables(quick.url) : []
  const free = vars.filter((v) => !taken.some((b) => b.location === 'path' && b.expression === v))
  return free.length > 0 ? { location: 'path', expression: free.at(-1)! } : { location: 'query', expression: '' }
}

/** A new row: a copy of `from`'s response, a blank value per condition (or the given ones). */
export function newRow(from: SimpleForm, by: GroupBy[], values?: string[]): ResponseRow {
  return { key: rowKey(), values: by.map((_, i) => values?.[i] ?? ''), form: structuredClone({ ...from, name: '', scenario: { ...from.scenario, enabled: false } }) }
}

/** Adds the first row (and its first condition, from the URL). */
export function addFirstRow(form: SimpleForm, responses: Responses): Responses {
  const by = responses.by.length > 0 ? responses.by : [suggestBy(form.quick!)]
  return { ...responses, by, rows: [...responses.rows, newRow(form, by)] }
}

/** "Add a response for 999" (a near miss): a row with those values, unless one already has them. */
export function withValuesRow(form: SimpleForm, responses: Responses, values: (string | null)[]): Responses {
  const wanted = responses.by.map((_, i) => values[i] ?? '')
  if (wanted.every((v) => v === '') || responses.rows.some((r) => JSON.stringify(r.values) === JSON.stringify(wanted))) return responses
  const from = responses.rows.at(-1)?.form ?? form
  return { ...responses, rows: [...responses.rows, newRow(from, responses.by, wanted)] }
}

/** "orderId = 2003 · X-Tenant = acme" for a row (values left empty are "any" and left out). */
export function rowLabel(by: GroupBy[], values: string[]): string {
  return by
    .map((b, i) => (values[i]?.trim() ? `${conditionLabel(b)} = ${values[i]!.trim()}` : null))
    .filter(Boolean)
    .join(' · ')
}

/** A short summary of a response for a collapsed row: its status and the start of its body. */
export function responseSummary(form: SimpleForm): { status: number | null; text: string } {
  if (form.answer === 'proxy') return { status: null, text: form.proxy.baseUrl }
  if (form.fault) return { status: null, text: form.fault }
  if (form.binary) return { status: form.status, text: form.binary.name || form.binary.contentType }
  const text = form.body.replace(/\s+/g, ' ').trim()
  return { status: form.status, text: text.length > 80 ? `${text.slice(0, 80)}…` : text }
}
