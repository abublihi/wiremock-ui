import { safeRecord, type AuditLog } from '../audit/log'
import { longestPrefixMatch } from '../catalog/prefix'
import type { CatalogService } from '../catalog/service'
import { NotFoundError } from '../errors'
import { MARKER_ID } from '../sync/marker'
import type { WireMockClient } from '../wiremock/client'
import type { LoggedEvent } from '../wiremock/types'
import { explainMismatch, type FieldDiff } from './explain'

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
  stub: { id: string; name: string | null; owner: string | null; integration: string | null }
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

const DEFAULT_LIMIT = 200
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
    const [events, integrations] = await Promise.all([
      this.deps.wiremock.listRequests({ limit, since: filter.since }),
      this.deps.catalog.listIntegrations(),
    ])
    const prefixes = integrations.map((i) => ({ key: i.key, prefix: i.prefix }))
    const q = filter.q?.toLowerCase()
    const out: RequestSummary[] = []
    for (const e of events) {
      if (isMarker(e)) continue
      const summary = summarize(e, longestPrefixMatch([e.request.url], prefixes) ?? null)
      if (filter.matched !== undefined && summary.matched !== filter.matched) continue
      if (filter.integration !== undefined && summary.integration !== filter.integration) continue
      if (filter.status !== undefined && summary.status !== filter.status) continue
      // Body text only: bodyAsBase64 can be large and binary.
      if (q && !e.request.url.toLowerCase().includes(q) && !(e.request.body ?? '').toLowerCase().includes(q)) continue
      out.push(summary)
    }
    return out
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
    return misses
      .filter((m) => m.stubMapping.id !== MARKER_ID)
      .sort((a, b) => a.matchResult.distance - b.matchResult.distance)
      .slice(0, NEAR_MISS_LIMIT)
      .map((m) => {
        const meta = m.stubMapping.metadata?.wiremockUi
        return {
          stub: {
            id: m.stubMapping.id,
            name: m.stubMapping.name ?? null,
            owner: meta?.owner ?? null,
            integration: meta?.integration ?? null,
          },
          distance: m.matchResult.distance,
          diffs: explainMismatch(m.stubMapping, event.request),
        }
      })
  }

  async clear(actor: string): Promise<void> {
    await this.deps.wiremock.clearRequests()
    await safeRecord(this.deps.audit, { actor, action: 'requests.clear' })
  }

  /**
   * How many requests matched no mock since `since` (ms), up to `cap`: WireMock filters the whole journal for
   * unmatched requests first, so heavy matched traffic cannot push them out of a limited page.
   */
  async countUnmatchedSince(since: number, cap: number): Promise<{ count: number; capped: boolean }> {
    const requests = await this.deps.wiremock.listUnmatchedRequests()
    let count = 0
    for (const r of requests) {
      const at = typeof r.loggedDate === 'number' ? r.loggedDate : Date.parse(r.loggedDateString ?? '')
      if (!(at >= since) || pathOf(r.url) === MARKER_PATH) continue
      if (++count > cap) return { count: cap, capped: true }
    }
    return { count, capped: false }
  }

  count(pattern: Record<string, unknown>): Promise<number> {
    return this.deps.wiremock.countRequests(pattern)
  }
}

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
