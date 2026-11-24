import type { Runtime } from '../runtime'
import { ValidationError } from '../errors'
import type { AuditEntry, AuditPage } from './log'

/** What an entry is about, by name; `name: null` when it no longer exists (a deleted mock, say). */
export type AuditSubject = { kind: 'mock' | 'integration' | 'endpoint' | 'user'; name: string | null }
export type AuditView = AuditEntry & { subject?: AuditSubject }
export type AuditViewPage = { entries: AuditView[]; nextCursor: string | null; scanLimitReached?: boolean }

export type AuditFilter = { actor?: string; action?: string; from?: string; to?: string }

/** A filtered page reads at most this many entries of the log before it gives up filling. */
export const AUDIT_MAX_SCAN = 5000
const SCAN_PAGE = 500
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Reads the filter query parameters; an empty or malformed one is a 400 naming it. */
export function parseAuditFilter(q: URLSearchParams): AuditFilter {
  const out: AuditFilter = {}
  for (const name of ['actor', 'action'] as const) {
    const value = q.get(name)
    if (value === null) continue
    if (value.trim() === '') throw new ValidationError(`${name} must not be empty`, name)
    out[name] = value.trim()
  }
  for (const name of ['from', 'to'] as const) {
    const value = q.get(name)
    if (value === null) continue
    if (!DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new ValidationError(`${name} must be a day like 2026-11-20`, name)
    out[name] = value
  }
  return out
}

const isFiltered = (f: AuditFilter) => Object.keys(f).length > 0

function matches(entry: AuditEntry, f: AuditFilter): boolean {
  if (f.actor !== undefined && entry.actor !== f.actor) return false
  if (f.action !== undefined && entry.action !== f.action && !entry.action.startsWith(`${f.action}.`)) return false
  // Days are UTC, like the timestamps.
  const day = entry.at.slice(0, 10)
  if (f.from !== undefined && day < f.from) return false
  if (f.to !== undefined && day > f.to) return false
  return true
}

/**
 * A page of the audit log that passes the filters, newest first. Unfiltered, this is the log's own page. Filtered,
 * pages of the log are read until `limit` entries pass, at most AUDIT_MAX_SCAN entries per request; the cursor then
 * continues right after the last entry returned.
 */
export async function listAuditView(rt: Runtime, opts: { limit?: number; cursor?: string; filter: AuditFilter }): Promise<AuditViewPage> {
  if (!isFiltered(opts.filter)) {
    const page = await rt.audit.list({ limit: opts.limit, cursor: opts.cursor })
    return { ...page, entries: await withSubjects(rt, page.entries) }
  }
  const limit = opts.limit ?? 100
  const out: AuditEntry[] = []
  let cursor = opts.cursor
  let scanned = 0
  let page: AuditPage
  for (;;) {
    page = await rt.audit.list({ limit: SCAN_PAGE, cursor })
    scanned += page.entries.length
    for (let i = 0; i < page.entries.length; i++) {
      if (!matches(page.entries[i], opts.filter)) continue
      out.push(page.entries[i])
      if (out.length < limit) continue
      // Full: the cursor continues right after this entry (the log's own cursor, read again up to it).
      const rest = i < page.entries.length - 1 || page.nextCursor !== null
      const nextCursor = rest ? (await rt.audit.list({ limit: i + 1, cursor })).nextCursor : null
      return { entries: await withSubjects(rt, out), nextCursor }
    }
    if (!page.nextCursor) return { entries: await withSubjects(rt, out), nextCursor: null }
    cursor = page.nextCursor
    if (scanned >= AUDIT_MAX_SCAN) return { entries: await withSubjects(rt, out), nextCursor: cursor, scanLimitReached: true }
  }
}

function kindOf(entry: AuditEntry): AuditSubject['kind'] | null {
  if (!entry.target) return null
  if (entry.action.startsWith('mock.') && entry.action !== 'mock.reset-mine') return 'mock'
  if (entry.action.startsWith('catalog.integration.')) return 'integration'
  if (entry.action.startsWith('catalog.endpoint.')) return 'endpoint'
  if (entry.action.startsWith('user.')) return 'user'
  return null
}

/** Each entry with the name of the mock, integration, endpoint or user it is about (null when it is gone). */
async function withSubjects(rt: Runtime, entries: AuditEntry[]): Promise<AuditView[]> {
  const kinds = new Set(entries.map(kindOf))
  if (kinds.size === 1 && kinds.has(null)) return entries
  const safe = async <T>(f: () => Promise<T>, fallback: T) => {
    try {
      return await f()
    } catch {
      return fallback
    }
  }
  const [mocks, users] = await Promise.all([
    kinds.has('mock') ? safe(() => rt.mocks.list(), []) : [],
    kinds.has('user') ? safe(() => rt.users.list(), []) : [],
  ])
  const mockNames = new Map(mocks.map((m) => [m.id, m.name || m.id]))
  const userNames = new Set(users.map((u) => u.username))
  // Integrations and endpoints are retired: their old entries keep their kind, with no name to look up.
  const integrationNames = new Map<string, string>()
  const endpointNames = new Map<string, string>()
  return entries.map((e) => {
    const kind = kindOf(e)
    if (!kind) return e
    const t = e.target!
    const name =
      kind === 'mock'
        ? (mockNames.get(t) ?? null)
        : kind === 'integration'
          ? (integrationNames.get(t) ?? null)
          : kind === 'endpoint'
            ? (endpointNames.get(t) ?? null)
            : userNames.has(t)
              ? t
              : null
    return { ...e, subject: { kind, name } }
  })
}
