import { ValidationError } from '../../errors'
import { buildStub, simpleMockSchema } from '../../catalog/build'
import { json, parse, readJson, requireJson, withAuth, type AuthContext } from '../wrap'

const need = (value: string | undefined, name: string) => {
  if (!value) throw new ValidationError(`${name} is required`)
  return value
}

/** Reads the PUT body and fills `field` from the path; a different value in the body is a 400. */
async function putBody(request: Request, fields: Record<string, string>): Promise<Record<string, unknown>> {
  requireJson(request)
  const body = await readJson(request)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('body must be an object')
  for (const [field, expected] of Object.entries(fields)) {
    const given = (body as Record<string, unknown>)[field]
    if (given !== undefined && given !== expected) throw new ValidationError(`${field} in body does not match the path`)
  }
  return { ...body, ...fields }
}

/** `If-None-Match: *` asks for create-only: an existing key is a 409 instead of an overwrite. */
const createOnly = (request: Request) => ({ createOnly: request.headers.get('if-none-match')?.trim() === '*' })

const noContent = () => new Response(null, { status: 204 })

export const listIntegrations = withAuth('catalog.read', async ({ rt }) => json(await rt.catalog.listIntegrations()))

export const putIntegration = withAuth('catalog.write', async ({ rt, request, params, principal }) => {
  const key = need(params.key, 'key')
  return json(
    await rt.catalog.upsertIntegration(await putBody(request, { key }), principal.user.username, createOnly(request)),
  )
})

export const deleteIntegration = withAuth('catalog.delete', async ({ rt, params, principal }) => {
  await rt.catalog.deleteIntegration(need(params.key, 'key'), principal.user.username)
  return noContent()
})

export const listEndpoints = withAuth('catalog.read', async ({ rt, params }) =>
  json(await rt.catalog.listEndpoints(need(params.key, 'key'))),
)

export const getEndpoint = withAuth('catalog.read', async ({ rt, params }) =>
  json(await rt.catalog.getEndpoint(need(params.key, 'key'), need(params.endpoint, 'endpoint'))),
)

export const putEndpoint = withAuth('catalog.write', async ({ rt, request, params, principal }) => {
  const key = need(params.endpoint, 'endpoint')
  const integration = need(params.key, 'key')
  return json(
    await rt.catalog.upsertEndpoint(
      await putBody(request, { integration, key }),
      principal.user.username,
      createOnly(request),
    ),
  )
})

export const deleteEndpoint = withAuth('catalog.delete', async ({ rt, params, principal }) => {
  await rt.catalog.deleteEndpoint(need(params.key, 'key'), need(params.endpoint, 'endpoint'), principal.user.username)
  return noContent()
})

async function buildFromRequest({ rt, request, params }: AuthContext) {
  requireJson(request)
  const input = parse(simpleMockSchema, await readJson(request))
  const integration = need(params.key, 'key')
  const endpoint = await rt.catalog.getEndpoint(integration, need(params.endpoint, 'endpoint'))
  return buildStub(await rt.catalog.getIntegration(integration), endpoint, input)
}

export const previewMock = withAuth('mocks.read', async (ctx) => json(await buildFromRequest(ctx)))

export const createCatalogMock = withAuth('mocks.create', async (ctx) =>
  json(await ctx.rt.mocks.create(await buildFromRequest(ctx), ctx.principal.user), 201),
)
