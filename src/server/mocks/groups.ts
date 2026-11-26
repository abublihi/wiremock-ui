import { z } from 'zod'
import { quickMockSchema, quickRequest, quickResponse, quickMockName, webhookListener, type QuickMockInput } from '../catalog/build'
import type { KeyLocation } from '../catalog/types'
import { ValidationError } from '../errors'
import type { MockInput } from './service'
import { normaliseTags } from './tags'

/**
 * A mock with several responses, chosen by values in the request ("When orderId = 2003 and X-Tenant = acme → 409,
 * any other request → 200"). WireMock has no such thing: it is a set of ordinary stubs that share
 * `metadata.wiremockUi.group`. The group names the conditions (`by`: where each value is); each stub matches the
 * request plus its values (`values`, one per condition, null for "any"); the optional fallback stub has no `values`
 * and a lower priority (a higher number), so it answers every other request.
 *
 * Priorities: a response that leaves k conditions at "any" sits k below the base priority, so a more specific
 * response always wins over a less specific one; the fallback sits FALLBACK_STEP below (more than MAX_CONDITIONS - 1).
 */

export const KEY_LOCATIONS = ['path', 'query', 'header', 'jsonPath', 'xPath', 'form'] as const satisfies readonly KeyLocation[]

/** Where a deciding value is: a path template variable, a query parameter, a header, a body field (JSONPath or XPath) or a form field. */
export type GroupBy = { location: KeyLocation; expression: string }

/** What each stub of a group carries in metadata.wiremockUi.group. */
export type GroupMeta = {
  id: string
  /** The conditions, in order (at least one). */
  by: GroupBy[]
  /** One value per condition (null: any value); absent on the fallback ("every other request"). */
  values?: (string | null)[]
  /** The response's place in the editor (0, 1, …; the fallback is last). */
  order: number
}

/** How much lower than the responses the fallback sits: priority (5 by default) + this. */
export const FALLBACK_STEP = 5
/** WireMock's priority when a stub sets none. */
export const DEFAULT_PRIORITY = 5
export const MAX_RESPONSES = 100
/** At most this many conditions, so that the least specific response still sits above the fallback. */
export const MAX_CONDITIONS = 4

const responseSchema = quickMockSchema.pick({ status: true, body: true, base64Body: true, headers: true, delayMs: true, fault: true, proxy: true, webhook: true })

const bySchema = z.strictObject(
  {
    location: z.enum(KEY_LOCATIONS, { error: `by.location must be one of ${KEY_LOCATIONS.join(', ')}` }),
    expression: z.string({ error: 'by.expression must be a string' }),
  },
  { error: 'by must be an object' },
)

export const groupInputSchema = z.strictObject(
  {
    name: z.string({ error: 'name must be a string' }).optional(),
    tags: z.array(z.string({ error: 'tags must be a list of strings' }), { error: 'tags must be a list of strings' }).optional(),
    priority: z
      .number({ error: 'priority must be a whole number of 1 or more' })
      .int({ error: 'priority must be a whole number of 1 or more' })
      .min(1, { error: 'priority must be a whole number of 1 or more' })
      .optional(),
    request: quickMockSchema.shape.request,
    /** The conditions; one object is the same as a list of one. */
    by: z.union([bySchema, z.array(bySchema, { error: 'by must be a list' }).max(MAX_CONDITIONS, { error: `by holds at most ${MAX_CONDITIONS} conditions` })], {
      error: 'by must be a condition or a list of conditions',
    }),
    responses: z
      .array(
        z.strictObject(
          {
            /** One value per condition, null for any value. */
            values: z.array(z.string({ error: 'responses[].values must be strings or null' }).nullable(), { error: 'responses[].values must be a list' }).optional(),
            /** With one condition: its value (the same as `values: [value]`). */
            value: z.string({ error: 'responses[].value must be a string' }).optional(),
            response: responseSchema,
          },
          { error: 'responses[] must be objects' },
        ),
        { error: 'responses must be a list' },
      )
      .max(MAX_RESPONSES, { error: `responses holds at most ${MAX_RESPONSES} responses` }),
    /**
     * The answer for every other request; null or absent: no answer (WireMock tries other stubs, then 404). With no
     * responses it is required, and the mock is saved as a plain mock (one stub, no group).
     */
    fallback: z.strictObject({ response: responseSchema }, { error: 'fallback must be an object' }).nullable().optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)

export type GroupInput = z.infer<typeof groupInputSchema>
type GroupResponse = GroupInput['responses'][number]['response']

/** The conditions as a list. */
export const byList = (by: GroupBy | GroupBy[]): GroupBy[] => (Array.isArray(by) ? by : [by])

/** The `{name}` variables of a path template, in order. */
export const templateVariables = (url: string) => [...url.matchAll(/\{([^{}/]+)\}/g)].map((m) => m[1]!)

/** The request matcher for one value at `by`. */
function keyMatcher(by: GroupBy, value: string): Record<string, unknown> {
  const match = { equalTo: value }
  switch (by.location) {
    case 'path':
      return { pathParameters: { [by.expression]: match } }
    case 'query':
      return { queryParameters: { [by.expression]: match } }
    case 'header':
      return { headers: { [by.expression]: match } }
    case 'form':
      return { formParameters: { [by.expression]: match } }
    case 'jsonPath':
      return { bodyPatterns: [{ matchesJsonPath: { expression: by.expression, ...match } }] }
    case 'xPath':
      return { bodyPatterns: [{ matchesXPath: { expression: by.expression, ...match } }] }
  }
}

const sameBy = (a: GroupBy, b: GroupBy) =>
  a.location === b.location && (a.location === 'header' ? a.expression.toLowerCase() === b.expression.toLowerCase() : a.expression === b.expression)

function checkBy(input: GroupInput): GroupBy[] {
  const list = byList(input.by)
  if (list.length === 0) throw new ValidationError('by needs at least one condition')
  const request = quickRequest(input.request)
  const out: GroupBy[] = []
  for (const [i, raw] of list.entries()) {
    const field = list.length === 1 && !Array.isArray(input.by) ? 'by' : `by[${i}]`
    const expression = raw.expression.trim()
    if (expression === '') throw new ValidationError(`${field}.expression is required`)
    const { location } = raw
    if (location === 'path') {
      if (input.request.urlType !== 'template') throw new ValidationError(`${field}.location path needs a path template URL (request.urlType template)`)
      if (!templateVariables(input.request.url).includes(expression)) throw new ValidationError(`${field}.expression: the URL has no {${expression}}`)
    }
    // A value's matcher must not fight one the request already has.
    if (location === 'query' && isObject(request.queryParameters) && expression in request.queryParameters) {
      throw new ValidationError(`${field}.expression: the request already matches the query parameter ${expression}`)
    }
    if ((location === 'jsonPath' || location === 'xPath') && request.bodyPatterns !== undefined) {
      throw new ValidationError(`${field}: a body field cannot be combined with a request body to match`)
    }
    const by = { location, expression }
    if (out.some((b) => sameBy(b, by))) throw new ValidationError(`${field}: the same condition is there twice`)
    out.push(by)
  }
  return out
}

/** A response's values, one per condition (`value` is the one-condition shorthand). */
function valuesOf(r: GroupInput['responses'][number], i: number, count: number): (string | null)[] {
  if (r.values !== undefined && r.value !== undefined) throw new ValidationError(`responses[${i}]: give values or value, not both`)
  const values = r.values ?? (r.value !== undefined ? [r.value] : undefined)
  if (!values) throw new ValidationError(`responses[${i}].values is required`)
  if (values.length !== count) throw new ValidationError(`responses[${i}].values needs one value per condition (${count})`)
  if (values.some((v) => v === '')) throw new ValidationError(`responses[${i}].values must not be empty (null means any value)`)
  if (values.every((v) => v === null)) throw new ValidationError(`responses[${i}].values needs at least one value`)
  return values
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

type BuiltStub = MockInput & { serveEventListeners?: unknown[]; metadata: { wiremockUi: { group?: GroupMeta; tags?: string[] } } }

/**
 * The stubs of a group, in order (the fallback last), without ids: the service gives each one its id. With no
 * responses, the one stub of a plain mock (the fallback's response, no group).
 */
export function buildGroupStubs(input: GroupInput, id: string): BuiltStub[] {
  const name = input.name?.trim()
  if (name === '') throw new ValidationError('name must not be empty')
  const tags = normaliseTags(input.tags, 'tags')
  const base = quickRequest(input.request)
  const stubName = name ?? quickMockName(input.request)
  const stub = (response: GroupResponse, field: string, request: Record<string, unknown>, priority: number | undefined, group: GroupMeta | undefined): BuiltStub => {
    const quick = { request: input.request, ...response } as QuickMockInput
    if (!quick.fault && !quick.proxy && quick.status === undefined) throw new ValidationError(`${field}.status is required`)
    if (quick.proxy && quick.fault) throw new ValidationError("proxy and fault cannot be combined: a proxied mock answers with the real service's response")
    const res = quickResponse(quick)
    if (quick.delayMs !== undefined) res.fixedDelayMilliseconds = quick.delayMs
    return {
      name: stubName,
      ...(priority !== undefined ? { priority } : {}),
      request,
      response: res,
      ...(response.webhook ? { serveEventListeners: [webhookListener(response.webhook)] } : {}),
      metadata: { wiremockUi: { ...(tags ? { tags } : {}), ...(group ? { group } : {}) } },
    }
  }

  if (input.responses.length === 0) {
    if (!input.fallback) throw new ValidationError('responses needs at least one response, or a fallback for a plain mock')
    return [stub(input.fallback.response, 'fallback.response', { ...base }, input.priority, undefined)]
  }

  const by = checkBy(input)
  const seen = new Set<string>()
  const out = input.responses.map((r, order) => {
    const values = valuesOf(r, order, by.length)
    const key = JSON.stringify(values)
    if (seen.has(key)) throw new ValidationError(`responses[${order}].values: another response has the same values`)
    seen.add(key)
    let request: Record<string, unknown> = { ...base }
    for (const [i, v] of values.entries()) if (v !== null) request = mergeMatcher(request, keyMatcher(by[i]!, v))
    const anyCount = values.filter((v) => v === null).length
    const priority = anyCount === 0 ? input.priority : (input.priority ?? DEFAULT_PRIORITY) + anyCount
    return stub(r.response, `responses[${order}].response`, request, priority, { id, by, values, order })
  })
  if (input.fallback) {
    out.push(stub(input.fallback.response, 'fallback.response', { ...base }, (input.priority ?? DEFAULT_PRIORITY) + FALLBACK_STEP, { id, by, order: input.responses.length }))
  }
  return out
}

/** The request with the value's matcher added (a query or header map merged; body patterns appended). */
function mergeMatcher(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) out[k] = [...(Array.isArray(out[k]) ? (out[k] as unknown[]) : []), ...v]
    else if (isObject(v) && isObject(out[k])) out[k] = { ...(out[k] as object), ...v }
    else out[k] = v
  }
  return out
}

function readBy(raw: unknown): GroupBy | undefined {
  if (!isObject(raw)) return undefined
  const { location, expression } = raw
  if (!KEY_LOCATIONS.includes(location as KeyLocation) || typeof expression !== 'string') return undefined
  return { location: location as KeyLocation, expression }
}

/**
 * A stub's group metadata when it is well formed, else undefined. Reads the older one-condition shape too
 * (`by: { location, expression }`, `value: "…"`), as the same thing with one condition.
 */
export function groupOf(stub: { metadata?: { wiremockUi?: { group?: unknown } } }): GroupMeta | undefined {
  const g = stub.metadata?.wiremockUi?.group
  if (!isObject(g) || typeof g.id !== 'string' || g.id === '') return undefined
  const rawBy = Array.isArray(g.by) ? g.by : [g.by]
  const by = rawBy.map(readBy)
  if (by.length === 0 || by.length > MAX_CONDITIONS || by.some((b) => b === undefined)) return undefined
  let values: (string | null)[] | undefined
  if (g.values !== undefined) {
    if (!Array.isArray(g.values) || g.values.length !== by.length || !g.values.every((v) => v === null || typeof v === 'string')) return undefined
    values = g.values as (string | null)[]
  } else if (g.value !== undefined) {
    if (typeof g.value !== 'string' || by.length !== 1) return undefined
    values = [g.value]
  }
  return {
    id: g.id,
    by: by as GroupBy[],
    ...(values ? { values } : {}),
    order: typeof g.order === 'number' && Number.isInteger(g.order) ? g.order : 0,
  }
}

/** Throws when metadata.wiremockUi.group is present but malformed (a stub saved directly or imported). */
export function assertGroupMeta(raw: unknown, field = 'metadata.wiremockUi.group'): GroupMeta | undefined {
  if (raw === undefined || raw === null) return undefined
  const meta = groupOf({ metadata: { wiremockUi: { group: raw } } })
  if (!meta) throw new ValidationError(`${field} must be { id, by: [{ location, expression }], values?, order }`)
  return meta
}

/** Sorts a group's stubs into editor order: by `order`, the fallback last. */
export function byGroupOrder(a: { metadata?: unknown }, b: { metadata?: unknown }): number {
  const ga = groupOf(a as never)
  const gb = groupOf(b as never)
  const fa = ga?.values === undefined ? 1 : 0
  const fb = gb?.values === undefined ? 1 : 0
  return fa - fb || (ga?.order ?? 0) - (gb?.order ?? 0)
}

/** How a condition is named in sentences: `orderId`, `?status`, `X-Tenant`, `$.userId`. */
export function conditionLabel(by: GroupBy): string {
  return by.location === 'query' ? `?${by.expression}` : by.expression
}

/** "orderId = 2003 · X-Tenant = acme" (conditions left at any value are left out). */
export function valuesLabel(by: GroupBy[], values: (string | null)[]): string {
  return by
    .map((b, i) => (values[i] === null || values[i] === undefined ? null : `${conditionLabel(b)} = ${values[i]}`))
    .filter(Boolean)
    .join(' · ')
}
