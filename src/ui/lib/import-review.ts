import type { Bundle } from '@/server/bundle/shape'
import { MAX_TAGS, normaliseTag, tagProblem, tagsOf } from '@/server/mocks/tags'
import type { StubMapping } from '@/server/wiremock/types'

/**
 * The import review: the bundle's mocks grouped by the tag the page suggests for them. The user accepts or renames
 * each group's tag, unticks mocks, and adds tags to the selected ones; `reviewedBundle` turns that into what is sent.
 */

/** Why a group got its tag (the page words it). */
export type GroupReason =
  /** The mocks carry tags already: they keep them, nothing is suggested. */
  | { kind: 'tagged' }
  /** The mocks name an integration (an export from this UI): its key. */
  | { kind: 'integration'; integration: string }
  /** Every URL starts with the same path segment. */
  | { kind: 'prefix'; prefix: string }
  /** Nothing in common to suggest from. */
  | { kind: 'none' }

export type ReviewGroup = {
  /** Stable key (the suggestion, or a fixed key for "tagged" and "none"). */
  key: string
  /** The suggested tag ('' for "tagged" and "none"). */
  tag: string
  reason: GroupReason
  /** Indexes into bundle.mocks. */
  indexes: number[]
}

export type ReviewState = {
  /** Per group key: the tag as the user left it (starts as the suggestion). */
  tags: Record<string, string>
  /** Per group key: whether its tag is applied (starts on). */
  accepted: Record<string, boolean>
  /** Indexes into bundle.mocks the user unticked. */
  off: number[]
  /** Per index: tags added with "Add tag to selected". */
  extra: Record<number, string[]>
  /** Per Combinable key: fold those stubs into one mock with several responses (starts on). */
  combine: Record<string, boolean>
}

const URL_FIELDS = ['url', 'urlPath', 'urlPathTemplate', 'urlPattern', 'urlPathPattern'] as const
const TAGGED = '__tagged__'
const NONE = '__none__'

/** The stub's URL as written (whichever URL field it uses), or undefined. */
export function stubUrl(stub: StubMapping): string | undefined {
  for (const f of URL_FIELDS) {
    const v = stub.request?.[f]
    if (typeof v === 'string') return v
  }
  return undefined
}

/** The first path segment when it is a plain word (`/ajeer-app/api/x` → `ajeer-app`); regex or template parts don't count. */
export function firstSegment(url: string | undefined): string | undefined {
  const m = url ? /^\/([A-Za-z0-9._-]+)(?:[/?]|$)/.exec(url) : null
  if (!m) return undefined
  const tag = normaliseTag(m[1]!)
  return tag && !tagProblem(tag) ? tag : undefined
}

/** One mock's suggestion: its own tags first, then its integration, then its first URL segment. */
function suggestionFor(stub: StubMapping): { key: string; tag: string; reason: GroupReason } {
  if (tagsOf(stub).length > 0) return { key: TAGGED, tag: '', reason: { kind: 'tagged' } }
  const integration = stub.metadata?.wiremockUi?.integration
  if (typeof integration === 'string' && integration !== '') {
    const tag = normaliseTag(integration)
    if (tag && !tagProblem(tag)) return { key: `i:${tag}`, tag, reason: { kind: 'integration', integration } }
  }
  const segment = firstSegment(stubUrl(stub))
  if (segment) return { key: `p:${segment}`, tag: segment, reason: { kind: 'prefix', prefix: `/${segment}` } }
  return { key: NONE, tag: '', reason: { kind: 'none' } }
}

/** The groups, most mocks first; "tagged" and "none" come last. */
export function groupForReview(bundle: Pick<Bundle, 'mocks'>): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  bundle.mocks.forEach((stub, index) => {
    const s = suggestionFor(stub)
    const group = groups.get(s.key) ?? { key: s.key, tag: s.tag, reason: s.reason, indexes: [] }
    group.indexes.push(index)
    groups.set(s.key, group)
  })
  const rank = (g: ReviewGroup) => (g.key === TAGGED ? 1 : g.key === NONE ? 2 : 0)
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.indexes.length - a.indexes.length || (a.tag < b.tag ? -1 : 1))
}

export function initialReview(groups: ReviewGroup[], combinable: Combinable[] = []): ReviewState {
  return {
    combine: Object.fromEntries(combinable.map((c) => [c.key, true])),
    tags: Object.fromEntries(groups.map((g) => [g.key, g.tag])),
    accepted: Object.fromEntries(groups.map((g) => [g.key, g.tag !== ''])),
    off: [],
    extra: {},
  }
}

/** The group tag as it will be applied, or undefined when it is off, empty or not a usable tag. */
export function appliedGroupTag(group: ReviewGroup, state: ReviewState): string | undefined {
  if (!state.accepted[group.key]) return undefined
  const tag = normaliseTag(state.tags[group.key] ?? '')
  return tag && !tagProblem(tag) ? tag : undefined
}

/** The tags mock `index` of `group` gets: its own, the group's (if applied), then the ones added by hand. */
export function tagsForItem(stub: StubMapping, index: number, group: ReviewGroup, state: ReviewState): string[] {
  const out: string[] = []
  const groupTag = appliedGroupTag(group, state)
  for (const tag of [...tagsOf(stub), ...(groupTag ? [groupTag] : []), ...(state.extra[index] ?? [])]) {
    if (!out.includes(tag)) out.push(tag)
  }
  return out.slice(0, MAX_TAGS)
}

/**
 * What the import sends: the ticked mocks with their tags, the rest of the bundle as it was. `sent[i]` is the
 * original index of the i-th mock sent (to read the dry run's per-mock outcomes back onto the rows).
 */
export function reviewedBundle(
  bundle: Bundle,
  groups: ReviewGroup[],
  state: ReviewState,
  combinable: Combinable[] = [],
): { bundle: Bundle; sent: number[] } {
  const off = new Set(state.off)
  let source = bundle.mocks
  for (const c of combinable) if (state.combine[c.key]) source = combineStubs(source, c, off)
  const groupOf = new Map<number, ReviewGroup>()
  for (const g of groups) for (const i of g.indexes) groupOf.set(i, g)
  const mocks: StubMapping[] = []
  const sent: number[] = []
  source.forEach((stub, index) => {
    if (off.has(index)) return
    const tags = tagsForItem(stub, index, groupOf.get(index)!, state)
    const meta = typeof stub.metadata === 'object' && stub.metadata !== null ? stub.metadata : {}
    const ui = { ...(meta.wiremockUi ?? {}) } as Record<string, unknown>
    if (tags.length > 0) ui.tags = tags
    else delete ui.tags
    const metadata = Object.keys(ui).length > 0 ? { ...meta, wiremockUi: ui } : Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'wiremockUi'))
    const { metadata: _m, ...rest } = stub
    mocks.push((Object.keys(metadata).length > 0 ? { ...rest, metadata } : rest) as StubMapping)
    sent.push(index)
  })
  return { bundle: { ...bundle, mocks }, sent }
}

// ── Stubs that differ only by one URL segment → one mock with several responses ──────────────────────────────

/** Stubs of the bundle that look like one mock with several responses (`/x/1`, `/x/2`, and maybe `/x/.*`). */
export type Combinable = {
  /** Stable key: method + the template. */
  key: string
  method: string
  /** The shared URL as a path template (`/x/{seq}`). */
  template: string
  /** The template variable that takes the differing segment. */
  param: string
  /** Indexes of the stubs answering one value each, with that value. */
  members: { index: number; value: string }[]
  /** Index of a regex stub (`/x/.*`) answering every other value, if any. */
  fallback?: number
}

const WILDCARDS = ['.*', '.+', '[^/]+', '[^/]*']
const LITERAL_SEGMENT = /^[A-Za-z0-9._~%-]+$/
const REQUEST_KEYS = ['method', 'urlPath', 'urlPathPattern']

/** `SequenceNumber` → `sequenceNumber`; anything unusable → `id`. */
function paramName(before: string | undefined, taken: string[]): string {
  const base = before && /^[A-Za-z][A-Za-z0-9_]*$/.test(before) ? before[0]!.toLowerCase() + before.slice(1) : 'id'
  let name = base
  for (let n = 2; taken.includes(name); n++) name = `${base}${n}`
  return name
}

/** Only `method` and one plain URL field, no metadata of ours beyond tags, no scenario: safe to fold. */
function plainStub(stub: StubMapping): boolean {
  if (!stub.request || typeof stub.request !== 'object') return false
  const keys = Object.keys(stub.request)
  if (!keys.every((k) => REQUEST_KEYS.includes(k)) || typeof stub.request.method !== 'string') return false
  const ui = stub.metadata?.wiremockUi as Record<string, unknown> | undefined
  if (ui && (ui.group !== undefined || ui.integration !== undefined || ui.endpoint !== undefined)) return false
  return stub.scenarioName === undefined && stub.serveEventListeners === undefined
}

/**
 * Finds sets of at least two stubs with the same method whose exact paths differ in one segment only (all literal),
 * plus a regex stub for the same path with a wildcard there, when the bundle has one.
 */
export function findCombinable(bundle: Pick<Bundle, 'mocks'>): Combinable[] {
  type Exact = { index: number; method: string; segments: string[] }
  const exact: Exact[] = []
  const patterns: { index: number; method: string; url: string }[] = []
  bundle.mocks.forEach((stub, index) => {
    if (!plainStub(stub)) return
    const method = stub.request.method as string
    if (typeof stub.request.urlPath === 'string' && !('urlPathPattern' in stub.request)) {
      const segments = stub.request.urlPath.split('/')
      if (segments.slice(1).every((s) => LITERAL_SEGMENT.test(s))) exact.push({ index, method, segments })
    } else if (typeof stub.request.urlPathPattern === 'string' && !('urlPath' in stub.request)) {
      patterns.push({ index, method, url: stub.request.urlPathPattern })
    }
  })
  const out = new Map<string, Combinable>()
  const used = new Set<number>()
  for (const a of exact) {
    if (used.has(a.index)) continue
    // The segment a set varies at: the first one where another stub of the same shape differs. Not the first segment
    // (that names a service), and only values that look like ids (with a digit): /users and /orders stay apart.
    for (let at = 2; at < a.segments.length; at++) {
      const peers = exact.filter(
        (b) => !used.has(b.index) && b.method === a.method && b.segments.length === a.segments.length && b.segments.every((s, i) => i === at || s === a.segments[i]),
      )
      const values = new Set(peers.map((p) => p.segments[at]))
      if (peers.length < 2 || values.size !== peers.length || ![...values].every((v) => /\d/.test(v!))) continue
      const taken = a.segments.filter((s) => /^\{.*\}$/.test(s))
      const param = paramName(a.segments[at - 1], taken)
      const template = a.segments.map((s, i) => (i === at ? `{${param}}` : s)).join('/')
      const prefix = a.segments.slice(0, at).join('/')
      const suffix = a.segments.slice(at + 1).join('/')
      const fallback = patterns.find(
        (p) => p.method === a.method && WILDCARDS.some((w) => p.url === [prefix, w, ...(suffix ? [suffix] : [])].join('/')),
      )
      const key = `${a.method} ${template}`
      out.set(key, {
        key,
        method: a.method,
        template,
        param,
        members: peers.map((p) => ({ index: p.index, value: p.segments[at]! })),
        ...(fallback ? { fallback: fallback.index } : {}),
      })
      for (const p of peers) used.add(p.index)
      break
    }
  }
  return [...out.values()]
}

/** A stable id for a combined group, from its key (so a re-import keeps its ids). */
function groupIdFor(key: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < key.length; i++) {
    h1 = Math.imul(h1 ^ key.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 ^ key.charCodeAt(i), 2246822519) >>> 0
  }
  return `import-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

/** The stubs of `c` rewritten as one mock with several responses (others untouched); `on` false leaves them as they are. */
export function combineStubs(mocks: StubMapping[], c: Combinable, off: ReadonlySet<number>): StubMapping[] {
  const id = groupIdFor(c.key)
  const by = { location: 'path' as const, expression: c.param }
  const members = c.members.filter((m) => !off.has(m.index))
  if (members.length === 0) return mocks
  const names = new Set(members.map((m) => mocks[m.index]!.name).filter((n): n is string => typeof n === 'string' && n !== ''))
  const name = names.size === 1 ? [...names][0]! : `${c.method} ${c.template}`
  const out = [...mocks]
  const rewrite = (index: number, value: string | undefined, order: number) => {
    const stub = mocks[index]!
    const meta = (stub.metadata ?? {}) as Record<string, unknown>
    const ui = { ...((meta.wiremockUi as Record<string, unknown> | undefined) ?? {}) }
    ui.group = { id, by, ...(value === undefined ? {} : { value }), order }
    const request: Record<string, unknown> = { method: c.method, urlPathTemplate: c.template }
    if (value !== undefined) request.pathParameters = { [c.param]: { equalTo: value } }
    const { uuid: _uuid, ...rest } = stub
    out[index] = {
      ...rest,
      // A fallback must lose to every value: below them unless the file set a priority already.
      ...(value === undefined && stub.priority === undefined ? { priority: 10 } : {}),
      name,
      request,
      metadata: { ...meta, wiremockUi: ui },
    } as StubMapping
  }
  members.forEach((m, order) => rewrite(m.index, m.value, order))
  if (c.fallback !== undefined && !off.has(c.fallback)) rewrite(c.fallback, undefined, members.length)
  return out
}
