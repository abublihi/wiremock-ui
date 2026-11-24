import { z } from 'zod'
import { quickMockSchema, quickRequest, quickResponse, quickMockName, type QuickMockInput } from '../catalog/build'
import type { KeyLocation } from '../catalog/types'
import { ValidationError } from '../errors'
import type { MockInput } from './service'
import { normaliseTags } from './tags'

/**
 * A mock with several responses, chosen by one value in the request ("When seq = 1 → …, seq = 2 → …, any other seq
 * → …"). WireMock has no such thing: it is a set of ordinary stubs that share `metadata.wiremockUi.group`. Each
 * stub matches the request plus one value (`value`); the optional fallback stub has no `value` and a lower priority
 * (a higher number), so it answers every other value.
 */

export const KEY_LOCATIONS = ['path', 'query', 'header', 'jsonPath', 'xPath', 'form'] as const satisfies readonly KeyLocation[]

/** Where the deciding value is: a path template variable, a query parameter, a header, a body field (JSONPath or XPath) or a form field. */
export type GroupBy = { location: KeyLocation; expression: string }

/** What each stub of a group carries in metadata.wiremockUi.group. */
export type GroupMeta = {
  id: string
  by: GroupBy
  /** The value this stub answers; absent on the fallback ("any other value"). */
  value?: string
  /** The response's place in the editor (0, 1, …; the fallback is last). */
  order: number
}

/** How much lower than the responses the fallback sits: priority (5 by default) + this. */
export const FALLBACK_STEP = 5
/** WireMock's priority when a stub sets none. */
export const DEFAULT_PRIORITY = 5
export const MAX_RESPONSES = 100

const responseSchema = quickMockSchema.pick({ status: true, body: true, base64Body: true, headers: true, delayMs: true, fault: true, proxy: true })

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
    by: z.strictObject(
      {
        location: z.enum(KEY_LOCATIONS, { error: `by.location must be one of ${KEY_LOCATIONS.join(', ')}` }),
        expression: z.string({ error: 'by.expression must be a string' }),
      },
      { error: 'by must be an object' },
    ),
    responses: z
      .array(z.strictObject({ value: z.string({ error: 'responses[].value must be a string' }), response: responseSchema }, { error: 'responses[] must be objects' }), {
        error: 'responses must be a list',
      })
      .min(1, { error: 'responses needs at least one response' })
      .max(MAX_RESPONSES, { error: `responses holds at most ${MAX_RESPONSES} responses` }),
    /** The answer for every other value; null or absent: no answer (WireMock tries other stubs, then 404). */
    fallback: z.strictObject({ response: responseSchema }, { error: 'fallback must be an object' }).nullable().optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)

export type GroupInput = z.infer<typeof groupInputSchema>

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

function checkBy(input: GroupInput): GroupBy {
  const expression = input.by.expression.trim()
  if (expression === '') throw new ValidationError('by.expression is required')
  const { location } = input.by
  if (location === 'path') {
    if (input.request.urlType !== 'template') throw new ValidationError('by.location path needs a path template URL (request.urlType template)')
    if (!templateVariables(input.request.url).includes(expression)) {
      throw new ValidationError(`by.expression: the URL has no {${expression}}`)
    }
  }
  const request = quickRequest(input.request)
  // The value's matcher must not fight one the request already has.
  if (location === 'query' && isObject(request.queryParameters) && expression in request.queryParameters) {
    throw new ValidationError(`by.expression: the request already matches the query parameter ${expression}`)
  }
  if ((location === 'jsonPath' || location === 'xPath') && request.bodyPatterns !== undefined) {
    throw new ValidationError('by: a body field cannot be combined with a request body to match')
  }
  return { location, expression }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The stubs of a group, in order (the fallback last), without ids: the service gives each one its id. */
export function buildGroupStubs(input: GroupInput, id: string): (MockInput & { metadata: { wiremockUi: { group: GroupMeta } } })[] {
  const name = input.name?.trim()
  if (name === '') throw new ValidationError('name must not be empty')
  const by = checkBy(input)
  const seen = new Set<string>()
  for (const [i, r] of input.responses.entries()) {
    if (r.value === '') throw new ValidationError(`responses[${i}].value must not be empty`)
    if (seen.has(r.value)) throw new ValidationError(`responses[${i}].value: "${r.value}" is used twice`)
    seen.add(r.value)
  }
  const tags = normaliseTags(input.tags, 'tags')
  const base = quickRequest(input.request)
  const stubName = name ?? quickMockName(input.request)
  const stub = (response: GroupInput['responses'][number]['response'], value: string | undefined, order: number, priority: number | undefined) => {
    const quick = { request: input.request, ...response } as QuickMockInput
    if (!quick.fault && !quick.proxy && quick.status === undefined) throw new ValidationError(`responses[${order}].response.status is required`)
    if (quick.proxy && quick.fault) throw new ValidationError("proxy and fault cannot be combined: a proxied mock answers with the real service's response")
    const res = quickResponse(quick)
    if (quick.delayMs !== undefined) res.fixedDelayMilliseconds = quick.delayMs
    const request = value === undefined ? { ...base } : mergeMatcher(base, keyMatcher(by, value))
    const group: GroupMeta = { id, by, ...(value === undefined ? {} : { value }), order }
    return {
      name: stubName,
      ...(priority !== undefined ? { priority } : {}),
      request,
      response: res,
      metadata: { wiremockUi: { ...(tags ? { tags } : {}), group } },
    }
  }
  const out = input.responses.map((r, order) => stub(r.response, r.value, order, input.priority))
  if (input.fallback) out.push(stub(input.fallback.response, undefined, input.responses.length, (input.priority ?? DEFAULT_PRIORITY) + FALLBACK_STEP))
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

/** A stub's group metadata when it is well formed, else undefined. */
export function groupOf(stub: { metadata?: { wiremockUi?: { group?: unknown } } }): GroupMeta | undefined {
  const g = stub.metadata?.wiremockUi?.group
  if (!isObject(g) || typeof g.id !== 'string' || g.id === '' || !isObject(g.by)) return undefined
  const { location, expression } = g.by as Record<string, unknown>
  if (!KEY_LOCATIONS.includes(location as KeyLocation) || typeof expression !== 'string') return undefined
  if (g.value !== undefined && typeof g.value !== 'string') return undefined
  return {
    id: g.id,
    by: { location: location as KeyLocation, expression },
    ...(typeof g.value === 'string' ? { value: g.value } : {}),
    order: typeof g.order === 'number' && Number.isInteger(g.order) ? g.order : 0,
  }
}

/** Throws when metadata.wiremockUi.group is present but malformed (a stub saved directly or imported). */
export function assertGroupMeta(raw: unknown, field = 'metadata.wiremockUi.group'): GroupMeta | undefined {
  if (raw === undefined || raw === null) return undefined
  const meta = groupOf({ metadata: { wiremockUi: { group: raw } } })
  if (!meta) throw new ValidationError(`${field} must be { id, by: { location, expression }, value?, order }`)
  return meta
}

/** Sorts a group's stubs into editor order: by `order`, the fallback last. */
export function byGroupOrder(a: { metadata?: unknown }, b: { metadata?: unknown }): number {
  const ga = groupOf(a as never)
  const gb = groupOf(b as never)
  const fa = ga?.value === undefined ? 1 : 0
  const fb = gb?.value === undefined ? 1 : 0
  return fa - fb || (ga?.order ?? 0) - (gb?.order ?? 0)
}
