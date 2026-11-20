import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { buildQuickStub, type QuickMockInput } from '@/server/catalog/build'
import { EndpointPage } from '@/ui/components/catalog/EndpointPage'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
type Call = { method: string; path: string; body?: unknown }

function NewHarness({ initial = {} }: { initial?: NewMockSearch }) {
  const [search, setSearch] = useState<NewMockSearch>(initial)
  return <NewMockPage search={search} onSearchChange={setSearch} />
}

/** No integrations; the quick preview runs the real builder; creating a mock answers with an id. */
function mockEmptyCatalog(calls: Call[] = []) {
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])),
    http.post(`${BASE}/api/mocks/preview`, async ({ request }) => {
      const body = (await request.json()) as QuickMockInput
      calls.push({ method: 'POST', path: '/api/mocks/preview', body })
      return HttpResponse.json(buildQuickStub(body))
    }),
    http.post(`${BASE}/api/mocks`, async ({ request }) => {
      const body = await request.json()
      calls.push({ method: 'POST', path: '/api/mocks', body })
      return HttpResponse.json({ id: 'q-1', ...(body as object) }, { status: 201 })
    }),
  )
  return calls
}

describe('new mock with no integrations', () => {
  it('explains what an integration is and offers three ways on', async () => {
    mockEmptyCatalog()
    await renderApp(<NewHarness />)
    await screen.findByText('No integrations yet')
    expect(screen.getByText(/An integration is the system your app calls/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add an integration' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Mock a URL directly/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Start from blank JSON/ })).toBeTruthy()
    expect(screen.queryByText(/the catalog is empty/)).toBeNull()
  })

  it('Add an integration: the dialog saves it, then the page goes to its first endpoint (and back here after)', async () => {
    const calls = mockEmptyCatalog()
    server.use(
      http.put(`${BASE}/api/integrations/:key`, async ({ request, params }) => {
        const body = (await request.json()) as object
        calls.push({ method: 'PUT', path: `/api/integrations/${String(params.key)}`, body })
        return HttpResponse.json({ ...body, key: params.key, updatedAt: '', updatedBy: 'sara' })
      }),
    )
    const { router } = await renderApp(<NewHarness />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Add an integration' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add integration' })
    await ue.type(within(dialog).getByLabelText('Integration ID'), 'blog')
    await ue.type(within(dialog).getByLabelText('Name'), 'Blog')
    await ue.clear(within(dialog).getByLabelText('URL prefix'))
    await ue.type(within(dialog).getByLabelText('URL prefix'), '/blog')
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/integrations/blog/endpoints/new'))
    expect(router.state.location.search).toEqual({ next: 'mock' })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'Blog', prefix: '/blog' })
  })

  it('Start from blank JSON opens the Advanced editor', async () => {
    mockEmptyCatalog()
    await renderApp(<NewHarness />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /^Start from blank JSON/ }))
    await screen.findByText('// free-form stub JSON')
  })

  it('Mock a URL directly: the quick form saves through the server builder and the normal create', async () => {
    const calls = mockEmptyCatalog()
    const { router } = await renderApp(<NewHarness />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: /^Mock a URL directly/ }))
    await screen.findByText('// a mock for one URL, without an integration')
    const url = screen.getByRole('textbox', { name: 'URL' })
    await ue.clear(url)
    await ue.type(url, '/health')
    await ue.click(screen.getByRole('radio', { name: 'Not found 404' }))
    await ue.click(screen.getByRole('button', { name: 'Add query parameter' }))
    await ue.type(screen.getByRole('textbox', { name: 'Query parameters: Name' }), 'lang')
    await ue.type(screen.getByRole('textbox', { name: 'Query parameters: lang' }), 'en')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/q-1'))
    expect(calls.map((c) => c.path)).toEqual(['/api/mocks/preview', '/api/mocks'])
    expect(calls[0]!.body).toEqual({
      request: { method: 'GET', urlType: 'path', url: '/health', query: { lang: 'en' } },
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(calls[1]!.body).toEqual({
      name: 'GET /health',
      request: { method: 'GET', urlPath: '/health', queryParameters: { lang: { equalTo: 'en' } } },
      response: { status: 404, headers: { 'Content-Type': 'application/json' } },
    })
  })

  it('the quick form checks the URL before anything is sent', async () => {
    const calls = mockEmptyCatalog()
    await renderApp(<NewHarness initial={{ mode: 'url' }} />)
    const ue = userEvent.setup()
    const url = await screen.findByRole('textbox', { name: 'URL' })
    await ue.clear(url)
    await ue.type(url, 'health?x=1')
    expect(await screen.findByText('A path starts with /, for example /health.')).toBeTruthy()
    await ue.clear(url)
    await ue.type(url, '/health?x=1')
    expect(await screen.findByText(/Leave the query string out of the path/)).toBeTruthy()
    await ue.clear(url)
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    expect(await screen.findByText('Enter the URL path to mock, for example /health.')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })
})

describe('new mock with integrations', () => {
  it('offers "Not in the list? Mock a URL directly" under the picker', async () => {
    const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
      http.get(`${BASE}/api/integrations/nic/endpoints`, () => HttpResponse.json([])),
    )
    await renderApp(<NewHarness />)
    expect(await screen.findByText('Not in the list?')).toBeTruthy()
    // NIC has no endpoints: the picker says so and links to adding one, coming back here after.
    const add = await screen.findByRole('link', { name: 'Add one endpoint to NIC' })
    expect(add.getAttribute('href')).toBe('/integrations/nic/endpoints/new?next=mock')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mock a URL directly' }))
    await screen.findByRole('textbox', { name: 'URL' })
  })
})

describe('a saved quick mock opens in the same quick form', () => {
  it('reads method, URL, query and body back into Simple mode', async () => {
    const input: QuickMockInput = {
      request: { method: 'POST', urlType: 'template', url: '/users/{id}', query: { lang: 'en' }, body: '{"active":true}' },
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":7}',
    }
    const stub = { id: 'q-1', ...buildQuickStub(input), metadata: { wiremockUi: { owner: 'sara', version: 1, updatedAt: '', updatedBy: 'sara', source: 'ui' } } }
    server.use(
      http.get(`${BASE}/api/mocks/q-1`, () => HttpResponse.json(stub)),
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/config`, () => HttpResponse.json({ wiremockPublicUrl: 'http://localhost:8080', storeDriver: 'sqlite' })),
    )
    await renderApp(<EditMockPage id="q-1" />)
    expect(((await screen.findByRole('textbox', { name: 'URL' })) as HTMLInputElement).value).toBe('/users/{id}')
    expect(screen.getByRole('radio', { name: 'Path template' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('combobox', { name: 'Method' }).textContent).toContain('POST')
    expect((screen.getByRole('textbox', { name: 'Query parameters: lang' }) as HTMLInputElement).value).toBe('en')
    expect((screen.getByRole('textbox', { name: /^Request body must contain/ }) as HTMLTextAreaElement).value).toBe('{"active":true}')
    expect(screen.getByRole('tab', { name: 'Simple' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('endpoint page opened from the new-mock page', () => {
  it('saving goes back to the new mock with the endpoint picked', async () => {
    const integration: Integration = { key: 'blog', name: 'Blog', prefix: '/blog', updatedAt: '', updatedBy: '' }
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
      http.get(`${BASE}/api/integrations/blog/endpoints`, () => HttpResponse.json([])),
      http.put(`${BASE}/api/integrations/blog/endpoints/:key`, async ({ request, params }) =>
        HttpResponse.json({ ...((await request.json()) as object), integration: 'blog', key: params.key, updatedAt: '', updatedBy: 'sara' } as Endpoint),
      ),
    )
    const { router } = await renderApp(<EndpointPage integrationKey="blog" next="mock" />)
    const ue = userEvent.setup()
    expect((await screen.findByRole('link', { name: 'Back to the new mock' })).getAttribute('href')).toBe('/mocks/new')
    await ue.type(screen.getByLabelText('Endpoint ID'), 'list-posts')
    await ue.type(screen.getByLabelText('Name'), 'List posts')
    await ue.clear(screen.getByLabelText('Path'))
    await ue.type(screen.getByLabelText('Path'), '/posts')
    await ue.click(screen.getByRole('button', { name: 'Save endpoint' }))
    await screen.findByText(/new mock page/)
    expect(router.state.location.search).toEqual({ integration: 'blog', endpoint: 'list-posts' })
  })
})

describe('quick form: regex URLs', () => {
  it('an unparsable regex is flagged before anything is sent', async () => {
    const calls = mockEmptyCatalog()
    await renderApp(<NewHarness initial={{ mode: 'url' }} />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('radio', { name: 'Regex' }))
    const url = screen.getByRole('textbox', { name: 'URL' })
    await ue.clear(url)
    await ue.type(url, '/users/(')
    expect(await screen.findByText(/This is not a valid regular expression/)).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    expect(calls).toHaveLength(0)
  })
})

describe('the scenario a mock is added to survives adding an integration or endpoint first', () => {
  const scenario = { scenario: 'flow', state: 'approved', after: 'pending' }

  it('Add an integration carries scenario, state and after to the endpoint page', async () => {
    mockEmptyCatalog()
    server.use(
      http.get(`${BASE}/api/mocks`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/scenarios`, () => HttpResponse.json([])),
      http.put(`${BASE}/api/integrations/:key`, async ({ request, params }) =>
        HttpResponse.json({ ...((await request.json()) as object), key: params.key, updatedAt: '', updatedBy: 'sara' }),
      ),
    )
    const { router } = await renderApp(<NewHarness initial={scenario} />)
    const ue = userEvent.setup()
    const add = await screen.findByRole('button', { name: 'Add an integration' })
    expect(add.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(add.getAttribute('aria-describedby')!)?.textContent).toMatch(/Then describe one of its endpoints/)
    await ue.click(add)
    const dialog = await screen.findByRole('dialog', { name: 'Add integration' })
    await ue.type(within(dialog).getByLabelText('Integration ID'), 'blog')
    await ue.type(within(dialog).getByLabelText('Name'), 'Blog')
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/integrations/blog/endpoints/new'))
    expect(router.state.location.search).toEqual({ next: 'mock', ...scenario })
  })

  it('"Add one" in the picker carries it too, and sits outside the listbox', async () => {
    const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
      http.get(`${BASE}/api/integrations/nic/endpoints`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/mocks`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/scenarios`, () => HttpResponse.json([])),
    )
    await renderApp(<NewHarness initial={scenario} />)
    const add = await screen.findByRole('link', { name: 'Add one endpoint to NIC' })
    const href = new URL(add.getAttribute('href')!, BASE)
    expect(href.pathname).toBe('/integrations/nic/endpoints/new')
    expect(Object.fromEntries(href.searchParams)).toEqual({ next: 'mock', ...scenario })
    expect(add.closest('[role="listbox"]')).toBeNull()
    expect(screen.queryByRole('listbox')).toBeNull() // nothing to pick: no empty listbox either
  })

  it('the endpoint page goes back to the new mock with the endpoint and the scenario', async () => {
    const integration: Integration = { key: 'blog', name: 'Blog', prefix: '/blog', updatedAt: '', updatedBy: '' }
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
      http.get(`${BASE}/api/integrations/blog/endpoints`, () => HttpResponse.json([])),
      http.put(`${BASE}/api/integrations/blog/endpoints/:key`, async ({ request, params }) =>
        HttpResponse.json({ ...((await request.json()) as object), integration: 'blog', key: params.key, updatedAt: '', updatedBy: 'sara' }),
      ),
    )
    const { router } = await renderApp(<EndpointPage integrationKey="blog" next="mock" scenario={scenario} />)
    const ue = userEvent.setup()
    const back = await screen.findByRole('link', { name: 'Back to the new mock' })
    expect(new URL(back.getAttribute('href')!, BASE).searchParams.get('scenario')).toBe('flow')
    await ue.type(screen.getByLabelText('Endpoint ID'), 'list-posts')
    await ue.type(screen.getByLabelText('Name'), 'List posts')
    await ue.click(screen.getByRole('button', { name: 'Save endpoint' }))
    await screen.findByText(/new mock page/)
    expect(router.state.location.search).toEqual({ integration: 'blog', endpoint: 'list-posts', ...scenario })
  })
})
