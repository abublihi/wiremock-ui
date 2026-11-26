import type { GroupMeta } from '../mocks/groups'
import { normaliseTag, tagProblem } from '../mocks/tags'
import type { StubMapping } from '../wiremock/types'
import type { KeyLocation } from './types'

/**
 * Integrations and endpoints are gone (tags and mocks with several responses took their place). This turns a stub
 * still linked to them (metadata.wiremockUi.integration / endpoint: an older store, an older export, a seed file, a
 * Postman collection) into what the UI uses now:
 *
 *  - the integration's key becomes a tag;
 *  - the mocks of an endpoint with a key become one mock with several responses: a key mock answers its key value, the
 *    endpoint's default mock becomes "any other value" (their matchers and priorities are already right);
 *  - every other linked mock becomes a plain mock.
 *
 * Nothing WireMock matches changes: only the UI's metadata (and the names of a group's stubs) do. No Node imports:
 * the browser runs it too (a Postman collection).
 */

/** What the migration needs to know of an endpoint. */
export type LegacyEndpoint = { integration: string; key: string; name: string; lookup?: { location: KeyLocation; expression: string } }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The value a key mock answers (its key matcher's equalTo), or undefined when the stub has no such matcher. */
export function keyValueOf(request: Record<string, unknown>, lookup: NonNullable<LegacyEndpoint['lookup']>): string | undefined {
  const { location, expression } = lookup
  const fromMap = (field: string) => {
    const map = request[field]
    const m = isRecord(map) ? map[expression] : undefined
    return isRecord(m) && typeof m.equalTo === 'string' && Object.keys(m).length === 1 ? m.equalTo : undefined
  }
  switch (location) {
    case 'path':
      return fromMap('pathParameters')
    case 'query':
      return fromMap('queryParameters')
    case 'header':
      return fromMap('headers')
    case 'form':
      return fromMap('formParameters')
    default: {
      const key = location === 'jsonPath' ? 'matchesJsonPath' : 'matchesXPath'
      const patterns = request.bodyPatterns
      if (!Array.isArray(patterns) || patterns.length !== 1 || !isRecord(patterns[0])) return undefined
      const m = (patterns[0] as Record<string, unknown>)[key]
      return isRecord(m) && m.expression === expression && typeof m.equalTo === 'string' && Object.keys(m).length === 2 ? m.equalTo : undefined
    }
  }
}

/** Is the stub still linked to an integration or endpoint? */
export const isLinked = (stub: StubMapping): boolean => {
  const ui = stub.metadata?.wiremockUi as Record<string, unknown> | undefined
  return ui !== undefined && (ui.integration !== undefined || ui.endpoint !== undefined)
}

/** A stable group id for an endpoint's mocks. */
export const legacyGroupId = (integration: string, endpoint: string) => `endpoint-${integration}-${endpoint}`

/**
 * The stubs rewritten (only the linked ones change; order kept). `endpoints` are the ones the stubs may name; a stub
 * naming an endpoint that is not there just loses the link.
 */
export function migrateLinkedStubs(stubs: StubMapping[], endpoints: LegacyEndpoint[]): StubMapping[] {
  const byRef = new Map(endpoints.map((e) => [`${e.integration}/${e.key}`, e]))
  // Per endpoint with a key: its linked stubs, to decide which form a group (a group needs a value of its own).
  type Member = { index: number; value: string | undefined }
  const members = new Map<string, Member[]>()
  stubs.forEach((stub, index) => {
    if (!isLinked(stub)) return
    const ui = stub.metadata!.wiremockUi!
    const endpoint = ui.integration && ui.endpoint ? byRef.get(`${ui.integration}/${ui.endpoint}`) : undefined
    if (!endpoint?.lookup || !isRecord(stub.request)) return
    const list = members.get(`${endpoint.integration}/${endpoint.key}`) ?? []
    list.push({ index, value: keyValueOf(stub.request, endpoint.lookup) })
    members.set(`${endpoint.integration}/${endpoint.key}`, list)
  })
  const groupOf = new Map<number, { endpoint: LegacyEndpoint; meta: GroupMeta }>()
  for (const [ref, list] of members) {
    const endpoint = byRef.get(ref)!
    const valued = list.filter((m) => m.value !== undefined)
    // One default mock only, or two defaults (no single "any other"), or a value twice: they stay plain mocks.
    const fallbacks = list.filter((m) => m.value === undefined)
    if (valued.length === 0 || fallbacks.length > 1 || new Set(valued.map((m) => m.value)).size !== valued.length) continue
    const id = legacyGroupId(endpoint.integration, endpoint.key)
    const by = [{ location: endpoint.lookup!.location, expression: endpoint.lookup!.expression }]
    const sorted = [...valued].sort((a, b) => (a.value! < b.value! ? -1 : a.value! > b.value! ? 1 : 0))
    sorted.forEach((m, order) => groupOf.set(m.index, { endpoint, meta: { id, by, values: [m.value!], order } }))
    for (const f of fallbacks) groupOf.set(f.index, { endpoint, meta: { id, by, order: sorted.length } })
  }
  return stubs.map((stub, index) => {
    if (!isLinked(stub)) return stub
    const { integration, endpoint: _endpoint, ...ui } = stub.metadata!.wiremockUi! as Record<string, unknown>
    const tags = Array.isArray(ui.tags) ? (ui.tags as unknown[]).filter((t): t is string => typeof t === 'string') : []
    const tag = typeof integration === 'string' ? normaliseTag(integration) : null
    if (tag && !tagProblem(tag) && !tags.includes(tag)) tags.push(tag)
    const group = groupOf.get(index)
    const nextUi: Record<string, unknown> = { ...ui, ...(tags.length > 0 ? { tags } : {}), ...(group ? { group: group.meta } : {}) }
    return {
      ...stub,
      ...(group ? { name: group.endpoint.name } : {}),
      metadata: { ...stub.metadata, wiremockUi: nextUi },
    } as StubMapping
  })
}

/** The endpoints a bundle's `catalog` holds, as far as the migration needs them (anything malformed is skipped). */
export function legacyEndpointsOf(catalog: unknown[]): LegacyEndpoint[] {
  const out: LegacyEndpoint[] = []
  for (const raw of catalog) {
    if (!isRecord(raw) || typeof raw.integration !== 'string' || typeof raw.key !== 'string') continue
    const lookup = isRecord(raw.lookup) && typeof raw.lookup.location === 'string' && typeof raw.lookup.expression === 'string' ? (raw.lookup as LegacyEndpoint['lookup']) : undefined
    out.push({ integration: raw.integration, key: raw.key, name: typeof raw.name === 'string' ? raw.name : raw.key, ...(lookup ? { lookup } : {}) })
  }
  return out
}
