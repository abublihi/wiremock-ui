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

export function initialReview(groups: ReviewGroup[]): ReviewState {
  return {
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
export function reviewedBundle(bundle: Bundle, groups: ReviewGroup[], state: ReviewState): { bundle: Bundle; sent: number[] } {
  const off = new Set(state.off)
  const groupOf = new Map<number, ReviewGroup>()
  for (const g of groups) for (const i of g.indexes) groupOf.set(i, g)
  const mocks: StubMapping[] = []
  const sent: number[] = []
  bundle.mocks.forEach((stub, index) => {
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
