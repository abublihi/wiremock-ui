import { z } from 'zod'
import { groupInputSchema } from '../../mocks/groups'
import { idOf, json, parse, readJson, requireJson, withAuth } from '../wrap'

const version = z.number({ error: 'versions must map ids to non-negative integers' }).int().min(0)

const createBody = z.strictObject(
  {
    input: groupInputSchema,
    /** A mock (without several responses) the new one grows from: its first response keeps that mock's id. */
    replaces: z.strictObject({ id: z.string().min(1), version }, { error: 'replaces must be { id, version }' }).optional(),
  },
  { error: 'body must be an object' },
)

const updateBody = z.strictObject(
  {
    input: groupInputSchema,
    /** The version of every stub of the group as the editor loaded it. */
    versions: z.record(z.string(), version, { error: 'versions must map ids to non-negative integers' }),
  },
  { error: 'body must be an object' },
)

export const getGroup = withAuth('mocks.read', async ({ rt, params }) => json(await rt.mocks.getGroup(idOf(params))))

export const createGroup = withAuth('mocks.create', async ({ rt, request, principal }) => {
  requireJson(request)
  const body = parse(createBody, await readJson(request))
  return json(await rt.mocks.saveGroup(undefined, body.input, {}, principal.user, body.replaces), 201)
})

export const updateGroup = withAuth('mocks.editOwn', async ({ rt, request, params, principal }) => {
  requireJson(request)
  const body = parse(updateBody, await readJson(request))
  return json(await rt.mocks.saveGroup(idOf(params), body.input, body.versions, principal.user))
})

export const deleteGroup = withAuth('mocks.editOwn', async ({ rt, params, principal }) => {
  await rt.mocks.deleteGroup(idOf(params), principal.user)
  return new Response(null, { status: 204 })
})
