import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildQuickStub, type QuickMockInput } from '@/server/catalog/build'
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

/** The quick preview runs the real builder; creating a mock answers with an id. */
function mockEmptyCatalog(calls: Call[] = []) {
  server.use(
    http.get(`${BASE}/api/tags`, () => HttpResponse.json([])),
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

describe('new mock', () => {
  it('Start from blank JSON opens the Advanced editor; Use the form goes back', async () => {
    mockEmptyCatalog()
    await renderApp(<NewHarness />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Start from blank JSON' }))
    await screen.findByText('// free-form stub JSON')
    await ue.click(screen.getByRole('button', { name: 'Use the form' }))
    await screen.findByRole('textbox', { name: 'URL' })
  })

  it('opens on the form for a URL; it saves through the server builder and the normal create', async () => {
    const calls = mockEmptyCatalog()
    const { router } = await renderApp(<NewHarness />)
    const ue = userEvent.setup()
    await screen.findByText('// method, URL and the answer')
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

  it('the quick form saves a priority, and flags one that is not a whole number of 1 or more', async () => {
    const calls = mockEmptyCatalog()
    const { router } = await renderApp(<NewHarness initial={{ mode: 'url' }} />)
    const ue = userEvent.setup()
    const url = await screen.findByRole('textbox', { name: 'URL' })
    await ue.clear(url)
    await ue.type(url, '/health')
    const priority = screen.getByRole('textbox', { name: /^Priority/ })
    await ue.type(priority, '0')
    expect(await screen.findByText('Use a whole number of 1 or more, or leave it empty.')).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    expect(calls).toHaveLength(0)
    await ue.clear(priority)
    await ue.type(priority, '10')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/q-1'))
    expect(calls[0]!.body).toMatchObject({ priority: 10 })
    expect(calls[1]!.body).toMatchObject({ name: 'GET /health', priority: 10 })
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

  it('a URL mock with a priority opens in Simple mode with the priority filled in', async () => {
    const stub = {
      id: 'q-2',
      name: 'Mulesoft monitor (any)',
      request: { method: 'ANY', urlPathPattern: '/ajeer-app/api/.*' },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { status: 'ok' } },
      priority: 10,
      metadata: { wiremockUi: { owner: 'sara', version: 1, updatedAt: '', updatedBy: 'sara', source: 'ui' } },
    }
    server.use(
      http.get(`${BASE}/api/mocks/q-2`, () => HttpResponse.json(stub)),
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/config`, () => HttpResponse.json({ wiremockPublicUrl: 'http://localhost:8080', storeDriver: 'sqlite' })),
    )
    await renderApp(<EditMockPage id="q-2" />)
    expect(((await screen.findByRole('textbox', { name: 'URL' })) as HTMLInputElement).value).toBe('/ajeer-app/api/.*')
    expect((screen.getByRole('textbox', { name: /^Priority/ }) as HTMLInputElement).value).toBe('10')
    expect(screen.getByRole('tab', { name: 'Simple' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('quick form: a full URL', () => {
  it('keeps the path and moves the query to Query parameters when the field is left', async () => {
    mockEmptyCatalog()
    await renderApp(<NewHarness initial={{ mode: 'url' }} />)
    const ue = userEvent.setup()
    const url = await screen.findByRole('textbox', { name: 'URL' })
    await ue.clear(url)
    await ue.type(url, 'https://api.example.com/blog/posts?page=2')
    await ue.tab()
    expect((url as HTMLInputElement).value).toBe('/blog/posts')
    expect(screen.getByText(/The query string is now under Query parameters/)).toBeTruthy()
    expect(screen.getByDisplayValue('page')).toBeTruthy()
    expect(screen.getByDisplayValue('2')).toBeTruthy()
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
