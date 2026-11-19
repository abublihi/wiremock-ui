import { z } from 'zod'
import { clearSessionCookie, clientIp, isSecureRequest, sessionCookie, signSessionId } from '../../auth/session'
import { json, parse, readJson, requireJson, withAuth, withErrors } from '../wrap'

const credentials = z.object(
  {
    username: z.string({ error: 'username is required' }),
    password: z.string({ error: 'password is required' }),
  },
  { error: 'body must be an object' },
)

const passwordBody = z.object(
  {
    current: z.string({ error: 'current is required' }),
    next: z.string({ error: 'next is required' }),
  },
  { error: 'body must be an object' },
)

export const login = withErrors(async (rt, request) => {
  requireJson(request)
  const { username, password } = parse(credentials, await readJson(request))
  const { user, session } = await rt.users.login(username, password, clientIp(request, rt.config), rt.config)
  const cookie = sessionCookie(signSessionId(session.id, rt.config.sessionSecret), {
    secure: isSecureRequest(request, rt.config),
  })
  return json({ user, csrfToken: session.csrfToken }, 200, { 'Set-Cookie': cookie })
})

export const getSession = withAuth(null, async ({ principal }) =>
  json({ user: principal.user, csrfToken: principal.session?.csrfToken ?? null }),
)

export const logout = withAuth(null, async ({ rt, request, principal }) => {
  if (principal.session) await rt.users.logout(principal.session.id)
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie({ secure: isSecureRequest(request, rt.config) }) },
  })
})

export const changePassword = withAuth(null, async ({ rt, request, principal }) => {
  requireJson(request)
  const { current, next } = parse(passwordBody, await readJson(request))
  await rt.users.changeOwnPassword(principal.user.id, current, next, principal.session?.id)
  return new Response(null, { status: 204 })
})
