import { safeRecord, type AuditLog } from '../audit/log'
import { longestPrefixMatch } from '../catalog/prefix'
import type { CatalogService } from '../catalog/service'
import { NotFoundError, ValidationError } from '../errors'
import { MARKER_ID } from '../sync/marker'
import type { WireMockClient } from '../wiremock/client'
import type { LoggedEvent } from '../wiremock/types'
import { explainMismatch, requestKeyValue, type FieldDiff } from './explain'

export type RequestSummary = {
  id: string
  loggedAt: string
  method: string
  url: string
  status: number | null
  matched: boolean
  stubId: string | null
  stubName: string | null
  integration: string | null
  durationMs: number | null
}

export type NearMissView = {
  stub: { id: string; name: string | null; owner: string | null; integration: string | null; endpoint: string | null }
  /** For an endpoint mock: the value this request has where the endpoint keeps its key (null when none or unreadable). */
  keyValue: string | null
  distance: number
  diffs: FieldDiff[]
}

export type RequestFilter = {
  limit?: number
  since?: string
  matched?: boolean
  integration?: string
  status?: number
  q?: string
}

/** A page of older requests: `nextCursor` continues below the last row (null when nothing older matches). */
export type RequestPage = {
  requests: RequestSummary[]
  nextCursor: string | null
  /** The search stopped at the newest MAX_SCAN requests of the log; older ones are not reachable from here. */
  scanLimitReached?: boolean
}

const DEFAULT_LIMIT = 200
/** The unmatched-request count is read from WireMock at most this often (shared by every poller). */
export const UNMATCHED_CACHE_MS = 3000
/** "Load older" reads at most this many of the newest requests to fill a page (WireMock's log has no offset). */
export const MAX_SCAN = 10_000
const MAX_LIMIT = 1000
const NEAR_MISS_LIMIT = 3
const MARKER_PATH = '/__wiremock-ui/marker'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const pathOf = (url: string) => url.split('?')[0]

function isMarker(e: LoggedEvent): boolean {
  return (e.wasMatched && e.stubMapping?.id === MARKER_ID) || pathOf(e.request.url) === MARKER_PATH
}

export class RequestJournal {
  constructor(private readonly deps: { wiremock: WireMockClient; catalog: CatalogService; audit: AuditLog }) {}

  /**
   * Newest first. `limit` bounds the events fetched from WireMock; filters (and marker removal) are applied
   * afterwards, so a filtered page can hold fewer than `limit` rows.
   */
  async list(filter: RequestFilter = {}): Promise<RequestSummary[]> {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const [events, keep] = await Promise.all([this.deps.wiremock.listRequests({ limit, since: filter.since }), this.matcher(filter)])
    const out: RequestSummary[] = []
    for (const e of events) {
      const summary = keep(e)
      if (summary) out.push(summary)
    }
    return out
  }

  /**
   * "Load older": up to `limit` requests logged before `before` (`<loggedAt>|<id>` of the last row shown) that pass
   * the filters, newest first. WireMock's log only pages by count from the newest, so this reads the newest N
   * requests (doubling N until the page fills, up to MAX_SCAN), finds the cursor row and filters below it, so a
   * filtered view still fills its pages.
   */
  async listBefore(filter: RequestFilter, before: string): Promise<RequestPage> {
    const cursor = parseRequestCursor(before)
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const keep = await this.matcher(filter)
    for (let scan = Math.min(MAX_SCAN, Math.max(1000, 2 * limit)); ; scan = Math.min(MAX_SCAN, scan * 2)) {
      const events = await this.deps.wiremock.listRequests({ limit: scan, since: filter.since })
      const full = events.length >= scan
      const found = events.findIndex((e) => e.id === cursor.id)
      // The cursor row itself, or (if it left the log) the first row logged before it.
      const start = found !== -1 ? found + 1 : events.findIndex((e) => loggedMs(e) < cursor.at)
      if (start === -1) {
        if (full && scan < MAX_SCAN) continue
        return { requests: [], nextCursor: null, ...(full ? { scanLimitReached: true } : {}) }
      }
      const out: RequestSummary[] = []
      let i = start
      for (; i < events.length && out.length < limit; i++) {
        const summary = keep(events[i])
        if (summary) out.push(summary)
      }
      if (out.length === limit) {
        const more = i < events.length || full
        return { requests: out, nextCursor: more ? requestCursor(out[out.length - 1]) : null }
      }
      if (full && scan < MAX_SCAN) continue
      return { requests: out, nextCursor: null, ...(full ? { scanLimitReached: true } : {}) }
    }
  }

  /** The filter as a function: the row's summary when it passes, else null (the marker's requests never do). */
  private async matcher(filter: RequestFilter): Promise<(e: LoggedEvent) => RequestSummary | null> {
    const integrations = await this.deps.catalog.listIntegrations()
    const prefixes = integrations.map((i) => ({ key: i.key, prefix: i.prefix }))
    const q = filter.q?.toLowerCase()
    return (e) => {
      if (isMarker(e)) return null
      const summary = summarize(e, longestPrefixMatch([e.request.url], prefixes) ?? null)
      if (filter.matched !== undefined && summary.matched !== filter.matched) return null
      if (filter.integration !== undefined && summary.integration !== filter.integration) return null
      if (filter.status !== undefined && summary.status !== filter.status) return null
      // Body text only: bodyAsBase64 can be large and binary.
      if (q && !e.request.url.toLowerCase().includes(q) && !(e.request.body ?? '').toLowerCase().includes(q)) return null
      return summary
    }
  }

  async get(id: string): Promise<LoggedEvent> {
    const event = UUID.test(id) ? await this.deps.wiremock.getRequest(id) : null
    if (!event) throw new NotFoundError('Request not found')
    return event
  }

  /** The closest stubs for an unmatched request, each with a field-by-field explanation. Matched requests have none. */
  async nearMisses(id: string): Promise<NearMissView[]> {
    const event = await this.get(id)
    if (event.wasMatched) return []
    const misses = await this.deps.wiremock.nearMisses(event.request)
    const closest = misses
      .filter((m) => m.stubMapping.id !== MARKER_ID)
      .sort((a, b) => a.matchResult.distance - b.matchResult.distance)
      .slice(0, NEAR_MISS_LIMIT)
    return Promise.all(
      closest.map(async (m) => {
        const meta = m.stubMapping.metadata?.wiremockUi
        const integration = meta?.integration ?? null
        const linked = integration && meta?.endpoint ? await this.endpointKey(integration, meta.endpoint, event) : null
        return {
          stub: { id: m.stubMapping.id, name: m.stubMapping.name ?? null, owner: meta?.owner ?? null, integration, endpoint: linked?.endpoint ?? null },
          keyValue: linked?.keyValue ?? null,
          distance: m.matchResult.distance,
          diffs: explainMismatch(m.stubMapping, event.request),
        }
      }),
    )
  }

  /**
   * A near miss's catalog endpoint (null when it no longer exists) and the request's value for its key (null when the
   * endpoint has no key or the value can't be read).
   */
  private async endpointKey(integration: string, endpoint: string, event: LoggedEvent): Promise<{ endpoint: string; keyValue: string | null } | null> {
    try {
      const [i, e] = await Promise.all([this.deps.catalog.getIntegration(integration), this.deps.catalog.getEndpoint(integration, endpoint)])
      const root = i.prefix === '/' ? '' : i.prefix
      return { endpoint, keyValue: e.lookup ? requestKeyValue(e.lookup, root + e.path, event.request) : null }
    } catch {
      return null
    }
  }

  async clear(actor: string): Promise<void> {
    await this.deps.wiremock.clearRequests()
    this.unmatchedCache = null
    await safeRecord(this.deps.audit, { actor, action: 'requests.clear' })
  }

  /**
   * How many requests matched no mock since `since` (ms), up to `cap`: WireMock filters the whole journal for
   * unmatched requests first, so heavy matched traffic cannot push them out of a limited page.
   */
  async countUnmatchedSince(since: number, cap: number): Promise<{ count: number; capped: boolean }> {
    const requests = await this.unmatched()
    let count = 0
    for (const r of requests) {
      // Newest first: once one is older than the window, the rest are too.
      if (r.at < since) break
      if (Number.isNaN(r.at) || r.marker) continue
      if (++count > cap) return { count: cap, capped: true }
    }
    return { count, capped: false }
  }

  private unmatchedCache: { until: number; rows: Promise<{ at: number; marker: boolean }[]> } | null = null

  /**
   * WireMock's unmatched requests (time and whether it is the marker's), read at most once every
   * UNMATCHED_CACHE_MS for every tab and user polling the count: WireMock filters its whole log for each read.
   */
  private unmatched(): Promise<{ at: number; marker: boolean }[]> {
    const now = Date.now()
    if (this.unmatchedCache && this.unmatchedCache.until > now) return this.unmatchedCache.rows
    const rows = this.deps.wiremock.listUnmatchedRequests().then((requests) =>
      requests.map((r) => ({
        at: typeof r.loggedDate === 'number' ? r.loggedDate : Date.parse(r.loggedDateString ?? ''),
        marker: pathOf(r.url) === MARKER_PATH,
      })),
    )
    this.unmatchedCache = { until: now + UNMATCHED_CACHE_MS, rows }
    // A failed read is not cached.
    rows.catch(() => {
      if (this.unmatchedCache?.rows === rows) this.unmatchedCache = null
    })
    return rows
  }

  count(pattern: Record<string, unknown>): Promise<number> {
    return this.deps.wiremock.countRequests(pattern)
  }
}

/** `<loggedAt ISO>|<id>`: the row a "Load older" page starts below. */
export const requestCursor = (row: Pick<RequestSummary, 'loggedAt' | 'id'>) => `${row.loggedAt}|${row.id}`

export function parseRequestCursor(raw: string): { at: number; id: string } {
  const bar = raw.lastIndexOf('|')
  const at = bar === -1 ? Number.NaN : Date.parse(raw.slice(0, bar))
  const id = raw.slice(bar + 1)
  if (bar === -1 || Number.isNaN(at) || !/^\d{4}-\d{2}-\d{2}T/.test(raw) || id === '' || id.length > 64) {
    throw new ValidationError('before must be a request cursor: <loggedAt>|<id> of the last row shown', 'before')
  }
  return { at, id }
}

const loggedMs = (e: LoggedEvent) =>
  typeof e.request.loggedDate === 'number' ? e.request.loggedDate : Date.parse(e.request.loggedDateString ?? '')

function summarize(e: LoggedEvent, integration: string | null): RequestSummary {
  const logged = e.request.loggedDate
  return {
    id: e.id,
    loggedAt: e.request.loggedDateString ?? (typeof logged === 'number' ? new Date(logged).toISOString() : ''),
    method: e.request.method,
    url: e.request.url,
    status: e.response?.status ?? e.responseDefinition?.status ?? null,
    matched: e.wasMatched,
    // Unmatched events carry a synthetic stubMapping, so only trust it when the request matched.
    stubId: e.wasMatched ? (e.stubMapping?.id ?? null) : null,
    stubName: e.wasMatched ? (e.stubMapping?.name ?? null) : null,
    integration,
    durationMs: typeof e.timing?.totalTime === 'number' ? e.timing.totalTime : null,
  }
}
