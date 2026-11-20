import type { QueryClient } from '@tanstack/react-query'
import type { PublicUser } from '@/server/users/types'

export class ApiError extends Error {
  status: number
  /** A 400's request field (`lookup.expression`, `exampleResponses.200`), when the server names one. */
  field?: string
  constructor(status: number, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    if (field) this.field = field
  }
}

export type SessionData = { user: PublicUser; csrfToken: string | null }

/** The session query's key lives here (not in queries.ts) so the client can read the CSRF token without a cycle. */
export const SESSION_KEY = ['session'] as const

let queryClient: QueryClient | null = null

/** The browser's QueryClient; apiFetch reads the CSRF token from its session data. */
export function registerQueryClient(client: QueryClient): void {
  queryClient = client
}

/** The sign-in page itself: never a page to come back to after signing in. */
export const isLoginPath = (pathname: string) => /^\/login\/?$/.test(pathname)

function defaultOnUnauthorized(next: string): void {
  window.location.assign(`/login?next=${encodeURIComponent(next)}`)
}

let onUnauthorized: (next: string) => void = defaultOnUnauthorized

/** Replaces the 401 handler (the router navigates to /login?next=…); returns the previous one. */
export function setOnUnauthorized(handler: (next: string) => void): () => void {
  const previous = onUnauthorized
  onUnauthorized = handler
  return () => {
    onUnauthorized = previous
  }
}

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  /** Extra request headers, merged over Accept (Content-Type and CSRF are always set by the client). */
  headers?: Record<string, string>
  /** Set false for calls where a 401 is an expected answer (sign-in, the session probe). */
  redirectOnUnauthorized?: boolean
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function buildUrl(path: string, query: ApiOptions['query']): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  if (!SAFE_METHODS.has(method)) {
    headers['Content-Type'] = 'application/json'
    const token = queryClient?.getQueryData<SessionData>(SESSION_KEY)?.csrfToken
    if (token) headers['X-CSRF-Token'] = token
  }
  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (response.status === 204) return undefined as T
  const text = await response.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }

  if (!response.ok) {
    const message = (data as { error?: unknown } | undefined)?.error
    // Already on the sign-in page (just signed out, say): nothing to come back to, and no /login?next=/login…
    if (response.status === 401 && options.redirectOnUnauthorized !== false && !isLoginPath(window.location.pathname)) {
      onUnauthorized(window.location.pathname + window.location.search)
    }
    const field = (data as { field?: unknown } | undefined)?.field
    throw new ApiError(response.status, typeof message === 'string' ? message : response.statusText, typeof field === 'string' ? field : undefined)
  }
  return data as T
}
