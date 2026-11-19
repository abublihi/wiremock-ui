import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import type { PublicUser, Role } from '@/server/users/types'
import { AppShell, APP_NAV } from '@/ui/components/shell/AppShell'
import { HazardStrip } from '@/ui/components/shell/HazardStrip'
import { PrefsProvider, usePrefsState, type Prefs } from '@/ui/i18n'
import { RootDocument, prefsFromRequest } from '@/routes/__root'

const user = (role: Role): PublicUser => ({
  id: 'u1', username: 'sara', displayName: 'Sara Q', role, disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

const queryClient = new QueryClient()
const enPrefs: Prefs = { theme: 'system' }

async function renderShell(u: PublicUser | null, prefs: Prefs = enPrefs) {
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <PrefsProvider prefs={prefs} onThemeChange={() => {}}>
          <AppShell nav={APP_NAV} user={u}>
            <p>page content</p>
          </AppShell>
        </PrefsProvider>
      </QueryClientProvider>
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
  render(<RouterProvider router={router} />)
  await screen.findByText('page content')
}

function labelsOf(name: string) {
  const nav = screen.getByRole('navigation', { name })
  return within(nav).getAllByRole('link').map((a) => a.textContent?.trim())
}
const navLabels = () => labelsOf('Main navigation')

describe('HazardStrip', () => {
  it('renders role=note with the test-environment text', () => {
    render(
      <PrefsProvider prefs={enPrefs} onThemeChange={() => {}}>
        <HazardStrip />
      </PrefsProvider>,
    )
    expect(screen.getByRole('note')).toHaveProperty('textContent', 'Test environment — mocks only, never real data')
  })
})

describe('AppShell', () => {
  it('shows every nav item to a signed-in user, whatever the role field says', async () => {
    await renderShell(user('viewer'))
    expect(navLabels()).toEqual(['Mocks', 'Request log', 'Catalog', 'Users', 'Audit', 'Import'])
  })

  it('shows the hazard strip, the user and labelled icon-only controls', async () => {
    await renderShell(user('tester'))
    expect(screen.getByRole('note')).toBeTruthy()
    expect(screen.getByText('Sara Q')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy()
  })
})

describe('root document', () => {
  // happy-dom's Request drops the browser-forbidden Cookie header, so build the server-side shape.
  const request = (cookie: string) => ({ headers: new Headers({ cookie }) }) as Request

  it('renders lang=en and carries the theme class', () => {
    const html = renderToString(<RootDocument prefs={prefsFromRequest(request('wmui_theme=dark'))}>x</RootDocument>)
    expect(html).toMatch(/<html[^>]*lang="en"/)
    expect(html).toMatch(/<html[^>]*class="dark"/)
  })
})

describe('preference toggles and the mobile nav', () => {
  afterEach(() => {
    document.cookie = 'wmui_theme=; Max-Age=0; Path=/'
  })

  // The same wiring as the root route: live prefs state whose values RootDocument puts on <html>.
  async function renderLiveShell() {
    function Harness() {
      const { prefs, setTheme } = usePrefsState({ theme: 'light' })
      return (
        <div data-testid="document" className={prefs.theme}>
          <QueryClientProvider client={queryClient}>
            <PrefsProvider prefs={prefs} onThemeChange={setTheme}>
              <AppShell nav={APP_NAV} user={user('tester')}>
                <p>page content</p>
              </AppShell>
            </PrefsProvider>
          </QueryClientProvider>
        </div>
      )
    }
    const rootRoute = createRootRoute({ component: Harness })
    const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
    render(<RouterProvider router={router} />)
    await screen.findByText('page content')
  }

  it('choosing Dark writes wmui_theme=dark and applies the class', async () => {
    const ue = userEvent.setup()
    await renderLiveShell()
    await ue.click(screen.getByRole('button', { name: 'Theme' }))
    await ue.click(await screen.findByRole('menuitemradio', { name: 'Dark' }))

    expect(document.cookie).toContain('wmui_theme=dark')
    expect(screen.getByTestId('document').className).toBe('dark')
  })

  it('the mobile nav sheet opens from the menu button and closes after choosing an item', async () => {
    const ue = userEvent.setup()
    await renderLiveShell()
    await ue.click(screen.getByRole('button', { name: 'Open navigation' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeTruthy()

    await ue.click(within(sheet).getByRole('link', { name: 'Request log' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
