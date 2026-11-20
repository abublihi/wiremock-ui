import { useState, type ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CatalogPage } from '@/routes/_app/catalog.index'
import { MocksPage, type MocksSearch } from '@/routes/_app/mocks.index'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { UserMenu } from '@/ui/components/shell/UserMenu'
import { APP_NAV, navFor } from '@/ui/components/shell/AppShell'
import { ServerConfigProvider } from '@/ui/config'
import { mockCatalog, stored } from './editor-fixtures'
import { renderApp, testUser } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
  try {
    localStorage.clear()
  } catch {}
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const none = (ui: ReactNode) => <ServerConfigProvider config={{ storeDriver: 'none' }}>{ui}</ServerConfigProvider>
const outside = {
  id: '0000b0b0-0000-4000-8000-000000000001',
  name: 'Made in WireMock',
  request: { method: 'GET', urlPath: '/hello' },
  response: { status: 200 },
  metadata: { wiremockUi: { owner: 'wiremock', version: 1, updatedAt: '', updatedBy: 'wiremock', source: 'adopt' } },
}

function Mocks() {
  const [search, setSearch] = useState<MocksSearch>({})
  return <MocksPage search={search} onSearchChange={(next) => setSearch((s) => ({ ...s, ...next }))} />
}

describe('WireMock-only mode (STORE_DRIVER=none)', () => {
  it('nav has no Users entry; with a store it does', () => {
    expect(navFor({ storeDriver: 'none' }).map((i) => i.to)).not.toContain('/users')
    expect(navFor({ storeDriver: 'sqlite' })).toEqual(APP_NAV)
    expect(navFor(null)).toEqual(APP_NAV)
  })

  it('the mock list shows every WireMock stub: no My/All toggle, no owner filter, no Reset my mocks', async () => {
    const seen: URL[] = []
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/mocks`, ({ request }) => {
        seen.push(new URL(request.url))
        return HttpResponse.json([outside])
      }),
    )
    await renderApp(none(<Mocks />))
    await screen.findByText('Made in WireMock')
    expect(seen[0]!.searchParams.has('owner')).toBe(false)
    expect(screen.queryByRole('radio', { name: 'My mocks' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset my mocks' })).toBeNull()
  })

  it('a deleted mock gets no Undo (there is no history to restore from)', async () => {
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/mocks`, () => HttpResponse.json([outside])),
      http.delete(`${BASE}/api/mocks/:id`, () => new HttpResponse(null, { status: 204 })),
    )
    const user = userEvent.setup()
    await renderApp(none(<Mocks />))
    await user.click(await screen.findByRole('button', { name: 'Actions for Made in WireMock' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await screen.findByText('Mock deleted')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('the editor has no History button', async () => {
    mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored(3))))
    await renderApp(none(<EditMockPage id="m-1" />))
    await screen.findByRole('tab', { name: 'Advanced' })
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull()
  })

  it('the user menu offers no password change', async () => {
    const user = userEvent.setup()
    await renderApp(none(<UserMenu user={testUser} />))
    await user.click(screen.getByRole('button', { name: /Sara Q/ }))
    await screen.findByRole('menuitem', { name: 'Sign out' })
    expect(screen.queryByRole('menuitem', { name: 'Change password' })).toBeNull()
  })

  it('Catalog warns that changes are kept in memory; the banner can be dismissed', async () => {
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])),
    )
    const user = userEvent.setup()
    await renderApp(none(<CatalogPage />))
    const banner = await screen.findByRole('status')
    expect(banner.textContent).toContain('Catalog changes are kept in memory and lost on restart (WireMock-only mode)')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/kept in memory/)).toBeNull())
  })

  it('with a store none of this changes: the catalog shows no banner', async () => {
    server.use(http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])))
    await renderApp(<CatalogPage />)
    await screen.findByText('No integrations yet')
    expect(screen.queryByText(/kept in memory/)).toBeNull()
  })
})
