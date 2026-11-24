import { afterEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import type { PublicUser } from '@/server/users/types'
import { AppShell, APP_NAV, type NavCounts } from '@/ui/components/shell/AppShell'
import { HazardStrip } from '@/ui/components/shell/HazardStrip'
import { PrefsProvider, usePrefsState, type Prefs } from '@/ui/i18n'
import { RootDocument, prefsFromRequest } from '@/routes/__root'

const user = (_label = 'user'): PublicUser => ({
  id: 'u1', username: 'sara', displayName: 'Sara Q', disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

const queryClient = new QueryClient()
const enPrefs: Prefs = { theme: 'system' }

async function renderShell(u: PublicUser | null, prefs: Prefs = enPrefs, opts: { path?: string; counts?: NavCounts } = {}) {
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <PrefsProvider prefs={prefs} onThemeChange={() => {}}>
          <AppShell nav={APP_NAV} counts={opts.counts} user={u}>
            <p>page content</p>
          </AppShell>
        </PrefsProvider>
      </QueryClientProvider>
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [opts.path ?? '/'] }) })
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
  it('shows every nav item to a signed-in user', async () => {
    await renderShell(user())
    expect(navLabels()).toEqual(['Mocks', 'Scenarios', 'Request log', 'Recording', 'Import & export', 'Users', 'Audit', 'Guide'])
  })

  it('groups the nav by how people work: Work, Setup, Admin, then Help (Import is not under Admin)', async () => {
    await renderShell(user())
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const group = (name: string) => within(within(nav).getByRole('group', { name })).getAllByRole('link').map((a) => a.textContent?.trim())
    expect(within(nav).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Work', 'Setup', 'Admin', 'Help'])
    expect(group('Work')).toEqual(['Mocks', 'Scenarios', 'Request log', 'Recording'])
    expect(group('Setup')).toEqual(['Import & export'])
    expect(group('Admin')).toEqual(['Users', 'Audit'])
    expect(group('Help')).toEqual(['Guide'])
    expect(within(nav).getByText('// Help')).toBeTruthy()
    expect(within(nav).getByText('// Work')).toBeTruthy()
    expect(within(nav).getByText('// Setup')).toBeTruthy()
    expect(within(nav).getByText('// Admin')).toBeTruthy()
  })

  it.each([
    ['/scenarios/new', 'Scenarios'],
    ['/scenarios/flow/edit', 'Scenarios'],
    ['/mocks/new', 'Mocks'],
    ['/import', 'Import & export'],
  ])('on %s the %s item is the active one', async (path, label) => {
    await renderShell(user(), enPrefs, { path })
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const active = within(nav).getAllByRole('link').filter((a) => a.getAttribute('data-status') === 'active')
    expect(active.map((a) => a.textContent?.trim())).toEqual([label])
  })

  it('the Request log item shows the recent unmatched count when there is one', async () => {
    await renderShell(user(), enPrefs, { counts: { '/requests': 3 } })
    const link = within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: /Request log/ })
    expect(link.textContent).toContain('3')
    expect(within(link).getByText('3 unmatched in the last 15 min')).toBeTruthy()
  })

  it('no count when there are no unmatched requests', async () => {
    await renderShell(user(), enPrefs, { counts: { '/requests': 0 } })
    const link = within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Request log' })
    expect(link.textContent?.trim()).toBe('Request log')
  })

  it('shows the hazard strip, the user and labelled icon-only controls', async () => {
    await renderShell(user())
    expect(screen.getByRole('note')).toBeTruthy()
    expect(screen.getByText('Sara Q')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy()
  })

  it('brands the shell with a decorative blinking cursor and the // caption', async () => {
    await renderShell(user())
    const cursors = document.querySelectorAll('.cursor-blink')
    expect(cursors.length).toBeGreaterThan(0)
    cursors.forEach((c) => expect(c.getAttribute('aria-hidden')).toBe('true'))
    expect(screen.getAllByText('// WireMock mock console').length).toBeGreaterThan(0)
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

  it('renders the dark theme when there is no theme cookie', () => {
    const html = renderToString(<RootDocument prefs={prefsFromRequest(request(''))}>x</RootDocument>)
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
              <AppShell nav={APP_NAV} user={user()}>
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
