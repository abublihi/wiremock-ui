import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, SESSION_KEY, apiFetch, registerQueryClient, setOnUnauthorized } from '@/ui/api/client'
import { testSession } from './helpers'

// The real route tree pulls in the server routes (and node:sqlite), which this browser-like test environment
// cannot bundle on every Node version; the router wiring under test only needs a root and the sign-in route.
vi.mock('@/routeTree.gen', async () => {
  const { createRootRoute, createRoute } = await import('@tanstack/react-router')
  const rootRoute = createRootRoute()
  const login = createRoute({ getParentRoute: () => rootRoute, path: '/login' })
  return { routeTree: rootRoute.addChildren([login]) }
})

type Seen = { method: string; csrf: string | null; contentType: string | null; body: unknown }
const seen: Seen[] = []
const server = setupServer(
  http.all('http://localhost:3000/api/echo', async ({ request }) => {
    const text = await request.text()
    seen.push({
      method: request.method,
      csrf: request.headers.get('x-csrf-token'),
      contentType: request.headers.get('content-type'),
      body: text ? JSON.parse(text) : undefined,
    })
    return HttpResponse.json({ ok: true })
  }),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  seen.length = 0
  const queryClient = new QueryClient()
  queryClient.setQueryData(SESSION_KEY, testSession)
  registerQueryClient(queryClient)
})

describe('apiFetch', () => {
  it('sends X-CSRF-Token and JSON content type on POST/PUT/PATCH/DELETE, not on GET', async () => {
    await apiFetch('/api/echo')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) await apiFetch('/api/echo', { method, body: { a: 1 } })

    expect(seen[0]).toMatchObject({ method: 'GET', csrf: null, contentType: null })
    for (const entry of seen.slice(1)) {
      expect(entry.csrf).toBe('csrf-1')
      expect(entry.contentType).toBe('application/json')
      expect(entry.body).toEqual({ a: 1 })
    }
    expect(seen.map((s) => s.method)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  })

  it('appends query parameters and skips undefined ones', async () => {
    let url = ''
    server.use(http.get('http://localhost:3000/api/echo', ({ request }) => ((url = request.url), HttpResponse.json({}))))
    await apiFetch('/api/echo', { query: { q: 'a b', limit: 5, skip: undefined } })
    expect(url).toBe('http://localhost:3000/api/echo?q=a+b&limit=5')
  })

  it('ApiError carries status and the server message', async () => {
    server.use(http.get('http://localhost:3000/api/echo', () => HttpResponse.json({ error: 'No such mock' }, { status: 404 })))
    const error = await apiFetch('/api/echo').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, message: 'No such mock' })
  })

  it('ApiError carries the field a 400 names', async () => {
    server.use(http.get('http://localhost:3000/api/echo', () => HttpResponse.json({ error: 'needs text', field: 'lookup.expression' }, { status: 400 })))
    const error = await apiFetch('/api/echo').catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 400, message: 'needs text', field: 'lookup.expression' })
  })

  it('falls back to the status text when the body has no error', async () => {
    server.use(http.get('http://localhost:3000/api/echo', () => new HttpResponse('<html>', { status: 502, statusText: 'Bad Gateway' })))
    await expect(apiFetch('/api/echo')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
  })

  it('passes a 429 message through', async () => {
    server.use(
      http.post('http://localhost:3000/api/echo', () =>
        HttpResponse.json({ error: 'Too many login attempts; try again later' }, { status: 429 }),
      ),
    )
    await expect(apiFetch('/api/echo', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 429,
      message: 'Too many login attempts; try again later',
    })
  })

  it('204 resolves undefined', async () => {
    server.use(http.delete('http://localhost:3000/api/echo', () => new HttpResponse(null, { status: 204 })))
    await expect(apiFetch('/api/echo', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('401 redirects with next', async () => {
    server.use(http.get('http://localhost:3000/api/echo', () => HttpResponse.json({ error: 'Authentication required' }, { status: 401 })))
    const onUnauthorized = vi.fn()
    const restore = setOnUnauthorized(onUnauthorized)
    window.history.replaceState(null, '', '/mocks?tag=smoke')
    try {
      await expect(apiFetch('/api/echo')).rejects.toMatchObject({ status: 401 })
      expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith('/mocks?tag=smoke')
    } finally {
      restore()
      window.history.replaceState(null, '', '/')
    }
  })

  it('clears the whole cache on a 401 before redirecting (router wiring)', async () => {
    const { getRouter } = await import('@/router')
    const router = getRouter()
    const client = router.options.context.queryClient
    client.setQueryData(['mocks'], [{ id: 'user-a-mock' }])
    client.setQueryData(SESSION_KEY, testSession)
    server.use(http.get('http://localhost:3000/api/echo', () => HttpResponse.json({ error: 'Authentication required' }, { status: 401 })))
    await expect(apiFetch('/api/echo')).rejects.toMatchObject({ status: 401 })
    expect(client.getQueryData(['mocks'])).toBeUndefined()
    expect(client.getQueryData(SESSION_KEY)).toBeUndefined()
  })

  it('does not redirect on a 401 the caller expects (sign-in)', async () => {
    server.use(http.post('http://localhost:3000/api/echo', () => HttpResponse.json({ error: 'nope' }, { status: 401 })))
    const onUnauthorized = vi.fn()
    const restore = setOnUnauthorized(onUnauthorized)
    try {
      await expect(apiFetch('/api/echo', { method: 'POST', body: {}, redirectOnUnauthorized: false })).rejects.toBeInstanceOf(ApiError)
      expect(onUnauthorized).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
