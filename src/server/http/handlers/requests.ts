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

export const listRequests = withAuth('requests.read', async ({ rt, request }) =>
  json(await rt.requests.list(parseFilter(new URL(request.url).searchParams))),
)

export const getRequest = withAuth('requests.read', async ({ rt, params }) => json(await rt.requests.get(idOf(params))))

export const nearMisses = withAuth('requests.read', async ({ rt, params }) => json(await rt.requests.nearMisses(idOf(params))))

export const clearRequests = withAuth('requests.clear', async ({ rt, principal }) => {
  await rt.requests.clear(principal.user.username)
  return json({ ok: true })
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
