import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { BASE, type Call, jsonText, mockCatalog, setJson, stored } from './editor-fixtures'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const headersStub = () => stored(3, { request: { ...stored().request, headers: { 'X-Trace': { equalTo: '1' } } } })

describe('Advanced mode', () => {
  it('shows the server fields read-only and leaves them out of the editable JSON', async () => {
    mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(headersStub())))
    await renderApp(<EditMockPage id="m-1" />)

    // Simple mode can't show the headers matcher, so the mock opens in Advanced.
    const advanced = await screen.findByRole('tab', { name: 'Advanced' })
    expect(advanced.getAttribute('aria-selected')).toBe('true')
    const fields = screen.getByRole('region', { name: 'Server fields' })
    const value = (term: string) => within(fields).getByText(term).nextElementSibling?.textContent
    expect(value('ID')).toBe('m-1')
    expect(value('Owner')).toBe('sara')
    expect(value('Version')).toBe('3')
    expect(value('Updated by')).toBe('omar')
    expect(within(fields).queryByRole('textbox')).toBeNull()

    await waitFor(() => expect(jsonText()).toContain('"X-Trace"'))
    const editable = JSON.parse(jsonText())
    expect(editable).not.toHaveProperty('id')
    expect(editable).not.toHaveProperty('metadata')
    expect(editable.request.headers).toEqual({ 'X-Trace': { equalTo: '1' } })
  })

  it('invalid JSON disables Save and says where the error is', async () => {
    mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(headersStub())))
    await renderApp(<EditMockPage id="m-1" />)
    await screen.findByRole('tab', { name: 'Advanced', selected: true })
    const save = screen.getByRole('button', { name: 'Save mock' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)

    setJson('{\n  "request": {},\n  "response": {\n}')
    expect(await screen.findByText(/^Line 4, column 2: /)).toBeTruthy()
    expect(save.disabled).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Stub JSON' }).getAttribute('aria-invalid')).toBe('true')

    setJson('[]')
    expect(await screen.findByText('The stub must be a JSON object.')).toBeTruthy()
    expect(save.disabled).toBe(true)

    setJson('{"request": {"method": "GET"}, "response": {"status": 204}}')
    await waitFor(() => expect(save.disabled).toBe(false))
  })

  it('saves with PUT { stub, version }, putting the catalog link back', async () => {
    const calls: Call[] = []
    mockCatalog(server, calls)
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(headersStub())),
      http.put(`${BASE}/api/mocks/m-1`, async ({ request }) => {
        calls.push({ method: 'PUT', path: 'update', body: await request.json() })
        return HttpResponse.json(stored(4, { request: { method: 'GET', urlPath: '/x' }, response: { status: 204 } }))
      }),
    )
    await renderApp(<EditMockPage id="m-1" />)
    await screen.findByRole('tab', { name: 'Advanced', selected: true })
    setJson('{"name": "mine", "request": {"method": "GET", "urlPath": "/x"}, "response": {"status": 204}}')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save mock' }))
    await screen.findByText('Mock saved')
    expect(calls.find((c) => c.path === 'update')?.body).toEqual({
      stub: {
        name: 'mine',
        request: { method: 'GET', urlPath: '/x' },
        response: { status: 204 },
        metadata: { wiremockUi: { integration: 'nic', endpoint: 'get-citizen-info' } },
      },
      version: 3,
    })
    // The editor now holds the saved version.
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Server fields' })).getByText('4')).toBeTruthy())
  })
})

describe('Simple ↔ Advanced', () => {
  it('Simple → Advanced shows the preview; Advanced → Simple reads it back', async () => {
    const calls = mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored())))
    await renderApp(<EditMockPage id="m-1" />)
    const ue = userEvent.setup()
    const key = (await screen.findByLabelText('Value of $.idNo in the request body')) as HTMLInputElement
    await ue.clear(key)
    await ue.type(key, '77')

    await ue.click(screen.getByRole('tab', { name: 'Advanced' }))
    await waitFor(() => expect(jsonText()).toContain('"equalTo": "77"'))
    expect(calls.at(-1)).toMatchObject({ path: 'preview', body: { keyValue: '77', status: 404 } })

    setJson(jsonText().replace('"equalTo": "77"', '"equalTo": "78"'))
    await ue.click(screen.getByRole('tab', { name: 'Simple' }))
    expect(((await screen.findByLabelText('Value of $.idNo in the request body')) as HTMLInputElement).value).toBe('78')
  })

  it('refuses a lossy round-trip: a headers matcher added in JSON disables Simple mode', async () => {
    mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored())))
    await renderApp(<EditMockPage id="m-1" />)
    const ue = userEvent.setup()
    await screen.findByLabelText('Value of $.idNo in the request body')
    await ue.click(screen.getByRole('tab', { name: 'Advanced' }))
    await waitFor(() => expect(jsonText()).toContain('"equalTo": "42"'))

    const edited = JSON.parse(jsonText())
    edited.request.headers = { 'X-Trace': { equalTo: '1' } }
    setJson(JSON.stringify(edited, null, 2))
    await ue.click(screen.getByRole('tab', { name: 'Simple' }))

    expect(await screen.findByText('This mock uses options Simple mode can’t show.')).toBeTruthy()
    expect(screen.queryByLabelText('Value of $.idNo in the request body')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save mock' })).toBeNull()

    // Nothing was dropped: back in Advanced the headers matcher is still there.
    await ue.click(screen.getByRole('button', { name: 'Edit it in Advanced' }))
    await waitFor(() => expect(jsonText()).toContain('"X-Trace"'))
  })

  it('invalid JSON keeps Simple mode closed until it is fixed', async () => {
    mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(headersStub())))
    await renderApp(<EditMockPage id="m-1" />)
    await screen.findByRole('tab', { name: 'Advanced', selected: true })
    setJson('{')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Simple' }))
    expect(await screen.findByText('Fix the JSON in Advanced first.')).toBeTruthy()
  })
})

describe('new free-form mock', () => {
  function NewHarness() {
    const [search, setSearch] = useState<NewMockSearch>({})
    return <NewMockPage search={search} onSearchChange={setSearch} />
  }

  it('starts from blank JSON and creates with POST /api/mocks', async () => {
    const calls = mockCatalog(server)
    server.use(
      http.post(`${BASE}/api/mocks`, async ({ request }) => {
        calls.push({ method: 'POST', path: 'create', body: await request.json() })
        return HttpResponse.json({ ...stored(1), id: 'm-7' }, { status: 201 })
      }),
    )
    const { router } = await renderApp(<NewHarness />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Start from blank JSON' }))
    expect(await screen.findByRole('tab', { name: 'Advanced', selected: true })).toBeTruthy()
    expect(JSON.parse(jsonText())).toMatchObject({ request: { method: 'GET' }, response: { status: 200 } })

    setJson('{"request": {"method": "GET", "urlPath": "/free"}, "response": {"status": 201}}')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await screen.findByText('Mock saved')
    expect(calls.find((c) => c.path === 'create')?.body).toEqual({ request: { method: 'GET', urlPath: '/free' }, response: { status: 201 } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/m-7'))
  })
})

describe('unsaved changes', () => {
  it('navigation with unsaved changes asks to confirm', async () => {
    mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(headersStub())))
    const { router } = await renderApp(<EditMockPage id="m-1" />)
    await screen.findByRole('tab', { name: 'Advanced', selected: true })
    const ue = userEvent.setup()

    // Nothing changed yet: leaving is free.
    setJson(jsonText())
    router.history.push('/requests')
    await waitFor(() => expect(router.state.location.pathname).toBe('/requests'))
    router.history.push('/')
    await screen.findByRole('tab', { name: 'Advanced', selected: true })

    setJson('{"request": {}, "response": {"status": 418}}')
    router.history.push('/mocks')
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
    await ue.click(within(dialog).getByRole('button', { name: 'Stay' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/')
    expect(jsonText()).toContain('418')

    router.history.push('/mocks')
    await ue.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks'))
  })

  it('a Simple-mode change counts too', async () => {
    mockCatalog(server)
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored())))
    const { router } = await renderApp(<EditMockPage id="m-1" />)
    const ue = userEvent.setup()
    await ue.type(await screen.findByLabelText('Value of $.idNo in the request body'), '0')
    router.history.push('/mocks')
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeTruthy()
  })
})
