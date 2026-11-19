import { z } from 'zod'
import { AppError, ValidationError } from '../errors'
import { logger } from '../logger'
import type { MockInput } from '../mocks/service'
import type { Runtime } from '../runtime'
import { requireBasicAuth } from './auth'

type Params = { id?: string }
type Handler = (rt: Runtime, request: Request, params?: Params) => Promise<Response>

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

function withErrors(handler: Handler): Handler {
  return async (rt, request, params) => {
    try {
      return await handler(rt, request, params)
    } catch (err) {
      if (err instanceof AppError) {
        const headers = err.status === 401 ? { 'WWW-Authenticate': 'Basic realm="wiremock-ui"' } : undefined
        return json({ error: err.message }, err.status, headers)
      }
      logger.error({ err, url: request.url }, 'unhandled error')
      return json({ error: 'Internal error' }, 500)
    }
  }
}

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

function parse<T>(schema: z.ZodType<T>, data: unknown, prefix = ''): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = [...issue.path].map(String)
  // Zod reports a missing field with a generic message; name the field explicitly.
  const named = issue.message.includes(path[path.length - 1] ?? '\0') || path.length === 0 ? issue.message : `${path.join('.')}: ${issue.message}`
  throw new ValidationError(`${prefix}${named}`)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
}

const idOf = (params?: Params) => {
  if (!params?.id) throw new ValidationError('id is required')
  return params.id
}

function parseVersion(raw: string | null): number | undefined {
  if (raw === null) return undefined
  if (!/^\d+$/.test(raw)) throw new ValidationError('version must be a non-negative integer')
  return Number(raw)
}

export const listMocks = withErrors(async (rt, request) => {
  requireBasicAuth(request, rt.config)
  const q = new URL(request.url).searchParams
  const filter = { integration: q.get('integration') || undefined, owner: q.get('owner') || undefined }
  return json(await rt.mocks.list(filter))
})

export const createMock = withErrors(async (rt, request) => {
  const user = requireBasicAuth(request, rt.config)
  const body = parse(mockInput, await readJson(request))
  return json(await rt.mocks.create(body as MockInput, user), 201)
})

export const getMock = withErrors(async (rt, request, params) => {
  requireBasicAuth(request, rt.config)
  return json(await rt.mocks.get(idOf(params)))
})

export const updateMock = withErrors(async (rt, request, params) => {
  const user = requireBasicAuth(request, rt.config)
  const body = parse(updateBody, await readJson(request))
  return json(await rt.mocks.update(idOf(params), body.stub as MockInput, body.version, user))
})

export const deleteMock = withErrors(async (rt, request, params) => {
  const user = requireBasicAuth(request, rt.config)
  const version = parseVersion(new URL(request.url).searchParams.get('version'))
  await rt.mocks.delete(idOf(params), version, user)
  return new Response(null, { status: 204 })
})

export const healthz = withErrors(async (rt) => {
  const [store, wiremock] = await Promise.all([
    rt.store.ping().catch(() => false),
    rt.wiremock.ping().catch(() => false),
  ])
  const body = {
    ui: 'ok',
    store: store ? 'ok' : 'error',
    wiremock: wiremock ? 'ok' : 'error',
    lastSyncAt: rt.reconciler.lastSyncAt?.toISOString() ?? null,
    lastSyncError: rt.reconciler.lastError,
  }
  return json(body, store && wiremock ? 200 : 503)
})
