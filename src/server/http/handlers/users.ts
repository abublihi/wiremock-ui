import { z } from 'zod'
import { ValidationError } from '../../errors'
import { idOf, json, parse, readJson, requireJson, withAuth } from '../wrap'
import type { Role } from '../../users/types'

const createBody = z.object(
  {
    username: z.string({ error: 'username is required' }),
    displayName: z.string({ error: 'displayName must be a string' }).optional(),
    role: z.string({ error: 'role is required' }),
    password: z.string({ error: 'password is required' }),
  },
  { error: 'body must be an object' },
)

const updateBody = z.strictObject(
  {
    displayName: z.string({ error: 'displayName must be a string' }).optional(),
    role: z.string({ error: 'role must be a string' }).optional(),
    password: z.string({ error: 'password must be a string' }).optional(),
    disabled: z.boolean({ error: 'disabled must be a boolean' }).optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)

export const listUsers = withAuth('users.manage', async ({ rt }) => json(await rt.users.list()))

export const createUser = withAuth('users.manage', async ({ rt, request, principal }) => {
  requireJson(request)
  const body = parse(createBody, await readJson(request))
  return json(await rt.users.create({ ...body, role: body.role as Role }, principal.user.username), 201)
})

export const updateUser = withAuth('users.manage', async ({ rt, request, params, principal }) => {
  requireJson(request)
  const body = parse(updateBody, await readJson(request))
  if (Object.values(body).every((v) => v === undefined)) throw new ValidationError('patch must change at least one field')
  return json(await rt.users.update(idOf(params), { ...body, role: body.role as Role | undefined }, principal.user.username))
})

export const deleteUser = withAuth('users.manage', async ({ rt, params, principal }) => {
  await rt.users.remove(idOf(params), principal.user.username)
  return new Response(null, { status: 204 })
})
