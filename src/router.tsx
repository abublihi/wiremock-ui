import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { SESSION_KEY, registerQueryClient, setOnUnauthorized } from '@/ui/api/client'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  // One QueryClient per request on the server and one for the browser's lifetime.
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
  const router = createRouter({ routeTree, context: { queryClient }, scrollRestoration: true })
  setupRouterSsrQueryIntegration({ router, queryClient })
  if (typeof window !== 'undefined') {
    registerQueryClient(queryClient)
    setOnUnauthorized((next) => {
      queryClient.removeQueries({ queryKey: SESSION_KEY })
      void router.navigate({ to: '/login', search: { next } })
    })
  }
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
