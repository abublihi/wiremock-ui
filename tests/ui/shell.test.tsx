import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import type { PublicUser, Role } from '@/server/users/types'
import { AppShell, APP_NAV } from '@/ui/components/shell/AppShell'
import { HazardStrip } from '@/ui/components/shell/HazardStrip'
import { PrefsProvider, type Prefs } from '@/ui/i18n'
import { RootDocument, prefsFromRequest } from '@/routes/__root'

const user = (role: Role): PublicUser => ({
  id: 'u1', username: 'sara', displayName: 'Sara Q', role, disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

const enPrefs: Prefs = { locale: 'en', theme: 'system' }

async function renderShell(u: PublicUser | null, prefs: Prefs = enPrefs) {
  const rootRoute = createRootRoute({
    component: () => (
      <PrefsProvider prefs={prefs} onLocaleChange={() => {}} onThemeChange={() => {}}>
        <AppShell nav={APP_NAV} user={u}>
          <p>page content</p>
        </AppShell>
      </PrefsProvider>
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) })
  render(<RouterProvider router={router} />)
  await screen.findByText('page content')
}

function navLabels() {
  const nav = screen.getByRole('navigation', { name: 'Main navigation' })
  return within(nav).getAllByRole('link').map((a) => a.textContent?.trim())
}

describe('HazardStrip', () => {
  it('renders role=note with the test-environment text', () => {
    render(
      <PrefsProvider prefs={enPrefs} onLocaleChange={() => {}} onThemeChange={() => {}}>
        <HazardStrip />
      </PrefsProvider>,
    )
    expect(screen.getByRole('note')).toHaveProperty('textContent', 'Test environment — mocks only, never real data')
  })

  it('is translated in Arabic', () => {
    render(
      <PrefsProvider prefs={{ locale: 'ar', theme: 'system' }} onLocaleChange={() => {}} onThemeChange={() => {}}>
        <HazardStrip />
      </PrefsProvider>,
    )
    expect(screen.getByRole('note').textContent).toMatch(/بيئة اختبار/)
  })
})

describe('AppShell', () => {
  it('hides nav items the role lacks (viewer sees no Users/Audit/Import)', async () => {
    await renderShell(user('viewer'))
    expect(navLabels()).toEqual(['Mocks', 'Request log', 'Catalog'])
  })

  it('shows Users, Audit and Import to an admin', async () => {
    await renderShell(user('admin'))
    expect(navLabels()).toEqual(['Mocks', 'Request log', 'Catalog', 'Users', 'Audit', 'Import'])
  })

  it('shows the hazard strip, the user and labelled icon-only controls', async () => {
    await renderShell(user('tester'))
    expect(screen.getByRole('note')).toBeTruthy()
    expect(screen.getByText('Sara Q')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change language' })).toBeTruthy()
  })

  it('renders Arabic labels', async () => {
    await renderShell(user('viewer'), { locale: 'ar', theme: 'system' })
    expect(screen.getByRole('navigation', { name: 'التنقل الرئيسي' })).toBeTruthy()
  })
})

describe('root document', () => {
  // happy-dom's Request drops the browser-forbidden Cookie header, so build the server-side shape.
  const request = (cookie: string) => ({ headers: new Headers({ cookie }) }) as Request

  it('server render sets <html lang="ar" dir="rtl"> when wmui_lang=ar', () => {
    const html = renderToString(<RootDocument prefs={prefsFromRequest(request('wmui_lang=ar'))}>x</RootDocument>)
    expect(html).toMatch(/<html[^>]*lang="ar"/)
    expect(html).toMatch(/<html[^>]*dir="rtl"/)
  })

  it('defaults to English, left-to-right, and carries the theme class', () => {
    const html = renderToString(<RootDocument prefs={prefsFromRequest(request('wmui_theme=dark'))}>x</RootDocument>)
    expect(html).toMatch(/<html[^>]*lang="en"/)
    expect(html).toMatch(/<html[^>]*dir="ltr"/)
    expect(html).toMatch(/<html[^>]*class="dark"/)
  })
})
