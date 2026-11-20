import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { PublicUser } from '@/server/users/types'
import { SESSION_KEY, registerQueryClient, type SessionData } from '@/ui/api/client'
import { PrefsProvider } from '@/ui/i18n'
import { Toaster } from '@/ui/components/ui/sonner'
import { TooltipProvider } from '@/ui/components/ui/tooltip'

export const testUser: PublicUser = {
  id: 'u1', username: 'sara', displayName: 'Sara Q', disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
export const testSession: SessionData = { user: testUser, csrfToken: 'csrf-1' }

/**
 * Renders `ui` at "/" inside a router that also has "/login", "/mocks", "/mocks/new", "/scenarios", "/scenarios/$name/edit" and "/integrations/$key" pages that print
 * their search or params,
 * so tests can see where navigation ended up. Pass `session` to prime the query cache (and CSRF token).
 */
export async function renderApp(ui: ReactNode, opts: { path?: string; session?: SessionData | null } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  if (opts.session !== null) queryClient.setQueryData(SESSION_KEY, opts.session ?? testSession)
  registerQueryClient(queryClient)

  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <PrefsProvider prefs={{ theme: 'system' }} onThemeChange={() => {}}>
          <TooltipProvider>
            <RouterOutlet />
          </TooltipProvider>
          <Toaster />
        </PrefsProvider>
      </QueryClientProvider>
    ),
  })
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <main>{ui}</main> })
  const login = createRoute({
    getParentRoute: () => root,
    path: '/login',
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <main>login page {JSON.stringify(login.useSearch())}</main>,
  })
  const mocks = createRoute({ getParentRoute: () => root, path: '/mocks', component: () => <main>mocks page</main> })
  const other = createRoute({ getParentRoute: () => root, path: '/requests', component: () => <main>requests page</main> })
  const newMock = createRoute({
    getParentRoute: () => root,
    path: '/mocks/new',
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <main>new mock page {JSON.stringify(newMock.useSearch())}</main>,
  })
  const scenariosPage = createRoute({
    getParentRoute: () => root,
    path: '/scenarios',
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <main>scenarios page {JSON.stringify(scenariosPage.useSearch())}</main>,
  })
  const editScenario = createRoute({
    getParentRoute: () => root,
    path: '/scenarios/$name/edit',
    component: () => <main>edit scenario page {(editScenario.useParams() as { name: string }).name}</main>,
  })
  const integrationPage = createRoute({
    getParentRoute: () => root,
    path: '/integrations/$key',
    component: () => <main>integration page {(integrationPage.useParams() as { key: string }).key}</main>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, login, mocks, newMock, other, scenariosPage, editScenario, integrationPage]),
    history: createMemoryHistory({ initialEntries: [opts.path ?? '/'] }),
  })
  render(<RouterProvider router={router} />)
  await waitFor(() => expect(router.state.status).toBe('idle'))
  await screen.findAllByRole('main', { hidden: true }) // hidden: a modal open on load (a drawer from the URL) hides it
  return { router, queryClient }
}

import { Outlet } from '@tanstack/react-router'
function RouterOutlet() {
  return <Outlet />
}
