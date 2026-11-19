import { z } from 'zod'
import { ValidationError } from '../../errors'
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

export const listMocks = withAuth('mocks.read', async ({ rt, request }) => {
  const q = new URL(request.url).searchParams
  const filter = { integration: q.get('integration') || undefined, owner: q.get('owner') || undefined }
  return json(await rt.mocks.list(filter))
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
