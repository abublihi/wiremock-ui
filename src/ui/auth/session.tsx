import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { createIsomorphicFn, createServerFn } from '@tanstack/react-start'
import { ApiError, apiFetch, type SessionData } from '@/ui/api/client'
import { sessionQueryOptions } from '@/ui/api/queries'

/**
 * On the server the session is read by calling the handler behind GET /api/session directly with the
 * incoming request (its cookies included), instead of an HTTP round-trip to ourselves.
 */
const readSessionOnServer = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionData | null> => {
  const { getRequest } = await import('@tanstack/react-start/server')
  const { getRuntime } = await import('@/server/runtime')
  const { getSession } = await import('@/server/http/handlers/session')
  const response = await getSession(await getRuntime(), getRequest())
  if (response.status === 401) return null
  if (!response.ok) throw new ApiError(response.status, response.statusText)
  return (await response.json()) as SessionData
})

const loadSession = createIsomorphicFn()
  .server(async (): Promise<SessionData> => {
    const session = await readSessionOnServer()
    if (!session) throw new ApiError(401, 'Authentication required')
    return session
  })
  .client(() => apiFetch<SessionData>('/api/session', { redirectOnUnauthorized: false }))

/**
 * `beforeLoad` guard for the authenticated layout: resolves the session (cached in the query client,
 * which also holds the CSRF token) or redirects to /login with the page to come back to.
 */
export async function requireSession(
  queryClient: QueryClient,
  location: { pathname: string; searchStr: string },
  fetchSession: () => Promise<SessionData> = loadSession,
): Promise<SessionData> {
  try {
    return await queryClient.ensureQueryData(sessionQueryOptions(fetchSession))
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      queryClient.removeQueries({ queryKey: sessionQueryOptions().queryKey })
      throw redirect({ to: '/login', search: { next: location.pathname + location.searchStr } })
    }
    throw error
  }
}

/**
 * Only same-origin absolute paths are followed after sign-in; anything else (open redirect, or /login itself) goes to /mocks.
 * Control characters are refused too: browsers strip tabs and newlines, so "/\t/evil.example" would become "//evil.example".
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/mocks'
  if (/[\x00-\x1f\x7f]/.test(next)) return '/mocks'
  if (/^\/login\/?([?#]|$)/.test(next)) return '/mocks'
  return next
}

/** `beforeLoad` guard for /login: someone who is already signed in goes straight to the app. */
export async function redirectIfSignedIn(
  queryClient: QueryClient,
  fetchSession: () => Promise<SessionData> = loadSession,
): Promise<void> {
  try {
    await queryClient.ensureQueryData(sessionQueryOptions(fetchSession))
  } catch {
    return // not signed in (or the check failed): show the form
  }
  throw redirect({ to: '/mocks' })
}
