import { z } from 'zod'
import { ValidationError } from '../../errors'
import type { RequestFilter } from '../../requests/journal'
import { idOf, json, parse, readJson, requireJson, withAuth } from '../wrap'

const int = (raw: string, field: string, min: number, max: number) => {
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || n < min || n > max) throw new ValidationError(`${field} must be an integer between ${min} and ${max}`)
  return n
}

function parseFilter(q: URLSearchParams): RequestFilter {
  const limit = q.get('limit')
  const since = q.get('since')
  const matched = q.get('matched')
  const status = q.get('status')
  if (since && !(/^\d{4}-\d{2}-\d{2}T/.test(since) && !Number.isNaN(Date.parse(since)))) {
    throw new ValidationError('since must be an ISO-8601 timestamp')
  }
  if (matched && matched !== 'true' && matched !== 'false') throw new ValidationError('matched must be true or false')
  return {
    limit: limit ? int(limit, 'limit', 1, 1000) : undefined,
    since: since || undefined,
    matched: matched ? matched === 'true' : undefined,
    integration: q.get('integration') || undefined,
    status: status ? int(status, 'status', 100, 599) : undefined,
    q: q.get('q')?.trim() || undefined,
  }
}

/**
 * GET /api/requests?limit&since&matched&integration&status&q → RequestSummary[] (newest first; filters applied to the
 * newest `limit`). With `before=<loggedAt>|<id>` (the last row shown) → { requests, nextCursor, scanLimitReached? }:
 * the next `limit` older rows that pass the filters ("Load older"); `nextCursor` goes in the next `before`.
 */
export const listRequests = withAuth('requests.read', async ({ rt, request }) => {
  const q = new URL(request.url).searchParams
  const filter = parseFilter(q)
  const before = q.get('before')
  return json(before ? await rt.requests.listBefore(filter, before) : await rt.requests.list(filter))
})

export const getRequest = withAuth('requests.read', async ({ rt, params }) => json(await rt.requests.get(idOf(params))))

export const nearMisses = withAuth('requests.read', async ({ rt, params }) => json(await rt.requests.nearMisses(idOf(params))))

export const clearRequests = withAuth('requests.clear', async ({ rt, principal }) => {
  await rt.requests.clear(principal.user.username)
  return new Response(null, { status: 204 })
})

/** The sidebar badge shows at most "99+", so counting stops past this. */
export const UNMATCHED_COUNT_CAP = 100

/** `GET /api/requests/unmatched-count?minutes=15` → `{ count, capped }`: requests that matched no mock lately. */
export const recentUnmatchedCount = withAuth('requests.read', async ({ rt, request }) => {
  const raw = new URL(request.url).searchParams.get('minutes') ?? '15'
  const minutes = int(raw, 'minutes', 1, 1440)
  return json(await rt.requests.countUnmatchedSince(Date.now() - minutes * 60_000, UNMATCHED_COUNT_CAP))
})

const countBody = z.object(
  {
    pattern: z.record(z.string(), z.unknown(), { error: 'pattern must be an object' }).refine((v) => !Array.isArray(v), {
      message: 'pattern must be an object',
    }),
  },
  { error: 'body must be an object' },
)

export const countRequests = withAuth('requests.read', async ({ rt, request }) => {
  requireJson(request)
  const { pattern } = parse(countBody, await readJson(request))
  return json({ count: await rt.requests.count(pattern) })
})
