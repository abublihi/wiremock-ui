import { readdirSync } from 'node:fs'
import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import type { Runtime } from '../../../src/server/runtime'
import { startTestRuntime } from '../../helpers/http'

// Route files call getRuntime(); point it at the test runtime.
const holder: { rt?: Promise<Runtime> } = {}
vi.mock('../../../src/server/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/server/runtime')>()),
  getRuntime: () => holder.rt!,
}))

let env: Awaited<ReturnType<typeof startTestRuntime>>

beforeAll(async () => {
  env = await startTestRuntime()
  holder.rt = Promise.resolve(env.rt)
}, 120_000)
afterAll(async () => {
  await env?.stop()
})

type ServerHandler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>
const PUBLIC = new Set(['POST /api/session'])

async function apiRoutes() {
  const { routeTree } = await import('../../../src/routeTree.gen')
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() }, history: createMemoryHistory({ initialEntries: ['/'] }) })
  return Object.values(router.routesById as unknown as Record<string, { id: string; options: { server?: { handlers?: Record<string, ServerHandler> } } }>)
    .filter((r) => r.id.startsWith('/api/'))
    .flatMap((r) => Object.entries(r.options.server?.handlers ?? {}).map(([method, handler]) => ({ path: r.id, method, handler })))
}

test('the route table covers every file under src/routes/api', async () => {
  const paths = new Set((await apiRoutes()).map((r) => r.path))
  expect(paths.size).toBe(readdirSync('src/routes/api').filter((f) => f.endsWith('.ts')).length)
})

test('every /api route method answers 401 JSON { error } without credentials, except POST /api/session', async () => {
  const routes = await apiRoutes()
  expect(routes.length).toBeGreaterThan(30)
  for (const { path, method, handler } of routes) {
    if (PUBLIC.has(`${method} ${path}`)) continue
    const url = `http://ui.test${path.replace(/\$(\w+)/g, 'x-$1')}`
    const body = ['GET', 'HEAD', 'DELETE'].includes(method) ? undefined : '{}'
    const res = await handler({
      request: new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body }),
      params: { id: 'x-id', key: 'x-key', endpoint: 'x-endpoint' },
    })
    expect(res.status, `${method} ${path}`).toBe(401)
    expect(res.headers.get('content-type'), `${method} ${path}`).toContain('application/json')
    expect(await res.json(), `${method} ${path}`).toEqual({ error: 'Authentication required' })
  }
})
