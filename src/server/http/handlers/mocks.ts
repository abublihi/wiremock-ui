import { z } from 'zod'
import { ValidationError } from '../../errors'
import { MAX_PAGE_LIMIT } from '../../mocks/paging'
import type { MockInput } from '../../mocks/service'
import { idOf, json, parse, readJson, requireJson, withAuth } from '../wrap'

const object = (field: string) =>
  z.record(z.string(), z.unknown(), { error: `${field} must be an object` }).refine((v) => !Array.isArray(v), {
    message: `${field} must be an object`,
  })

const mockInput = z
  .object(
    {
      request: object('request'),
      response: object('response'),
      metadata: object('metadata').optional(),
    },
    { error: 'body must be an object' },
  )
  .loose()

const updateBody = z.object(
  {
    stub: mockInput,
    version: z.number({ error: 'version must be a non-negative integer' }).int('version must be a non-negative integer').min(0, 'version must be a non-negative integer'),
  },
  { error: 'body must be an object' },
)

function parseVersion(raw: string | null): number | undefined {
  if (raw === null) return undefined
  if (!/^\d+$/.test(raw)) throw new ValidationError('version must be a non-negative integer')
  return Number(raw)
}

function parseStatus(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || n < 100 || n > 599) throw new ValidationError('status must be an integer between 100 and 599')
  return n
}

/** `limit` and `offset` from the query, or null when there is no `limit` (the plain-array response). */
function parsePage(q: URLSearchParams): { limit: number; offset: number } | null {
  const limit = q.get('limit')
  const offset = q.get('offset')
  if (limit === null) {
    if (offset !== null) throw new ValidationError('offset needs limit')
    return null
  }
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > MAX_PAGE_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`)
  }
  if (offset !== null && !/^\d+$/.test(offset)) throw new ValidationError('offset must be a non-negative integer')
  return { limit: Number(limit), offset: offset === null ? 0 : Number(offset) }
}

const restoreBody = z.object(
  { version: z.number({ error: 'version must be a positive integer' }).int('version must be a positive integer').min(1, 'version must be a positive integer') },
  { error: 'body must be an object' },
)

export const listMocks = withAuth('mocks.read', async ({ rt, request, principal }) => {
  const q = new URL(request.url).searchParams
  const owner = q.get('owner') || undefined
  const filter = {
    integration: q.get('integration') || undefined,
    owner: owner === 'me' ? principal.user.username : owner,
    status: parseStatus(q.get('status')),
    q: q.get('q')?.trim() || undefined,
    // A scenario's name, or * for every mock that belongs to one.
    scenario: q.get('scenario') || undefined,
  }
  // With limit: { items, total, totalMocks, baseline, offset, limit }; without: the plain array scripts rely on.
  const page = parsePage(q)
  return json(page ? await rt.mocks.listPage(filter, page) : await rt.mocks.list(filter))
})

export const createMock = withAuth('mocks.create', async ({ rt, request, principal }) => {
  requireJson(request)
  const body = parse(mockInput, await readJson(request))
  return json(await rt.mocks.create(body as MockInput, principal.user), 201)
})

export const getMock = withAuth('mocks.read', async ({ rt, params }) => json(await rt.mocks.get(idOf(params))))

export const updateMock = withAuth('mocks.editOwn', async ({ rt, request, params, principal }) => {
  requireJson(request)
  const body = parse(updateBody, await readJson(request))
  return json(await rt.mocks.update(idOf(params), body.stub as MockInput, body.version, principal.user))
})

export const deleteMock = withAuth('mocks.editOwn', async ({ rt, request, params, principal }) => {
  const version = parseVersion(new URL(request.url).searchParams.get('version'))
  await rt.mocks.delete(idOf(params), version, principal.user)
  return new Response(null, { status: 204 })
})

export const duplicateMock = withAuth('mocks.create', async ({ rt, params, principal }) =>
  json(await rt.mocks.duplicate(idOf(params), principal.user), 201),
)

export const resetMine = withAuth('mocks.create', async ({ rt, principal }) => json(await rt.mocks.resetMine(principal.user)))

export const mockHistory = withAuth('mocks.read', async ({ rt, params }) => json(await rt.mocks.history(idOf(params))))

export const restoreMock = withAuth('mocks.editOwn', async ({ rt, request, params, principal }) => {
  requireJson(request)
  const body = parse(restoreBody, await readJson(request))
  return json(await rt.mocks.restore(idOf(params), body.version, principal.user))
})
