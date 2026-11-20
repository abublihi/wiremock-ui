import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { CatalogPage } from '@/routes/_app/integrations.index'
import { IntegrationPage } from '@/routes/_app/integrations.$key.index'
import { EndpointPage } from '@/ui/components/catalog/EndpointPage'
import { EndpointInfo } from '@/ui/components/editor/EndpointPicker'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', description: 'Civil registry', updatedAt: 'x', updatedBy: 'sara' }
const endpoint = (over: Partial<Endpoint> = {}): Endpoint => ({
  integration: 'nic',
  key: 'get-citizen',
  name: 'Fetch citizen',
  method: 'POST',
  path: '/citizens',
  pathType: 'exact',
  lookup: { location: 'jsonPath', expression: '$.idNo' },
  contentType: 'json',
  exampleResponses: { '200': '{"name":"Sara"}' },
  allowedStatuses: [200, 404],
  updatedAt: 'x',
  updatedBy: 'sara',
  ...over,
})

type Call = { method: string; path: string; body?: unknown; csrf?: string | null; ifNoneMatch?: string | null }
function mockApi(opts: { integrations?: Integration[]; endpoints?: Endpoint[]; put?: () => Response | Promise<Response> } = {}) {
  const calls: Call[] = []
  const record = async (request: Request): Promise<Call> => {
    const text = await request.text()
    const call = { method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : undefined, csrf: request.headers.get('x-csrf-token'), ifNoneMatch: request.headers.get('if-none-match') }
    calls.push(call)
    return call
  }
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json(opts.integrations ?? [integration])),
    http.get(`${BASE}/api/integrations/:key/endpoints`, () => HttpResponse.json(opts.endpoints ?? [endpoint()])),
    http.put(`${BASE}/api/integrations/:key`, async ({ request }) => {
      await record(request)
      return opts.put?.() ?? HttpResponse.json({ ...integration })
    }),
    http.put(`${BASE}/api/integrations/:key/endpoints/:endpoint`, async ({ request }) => {
      await record(request)
      return opts.put?.() ?? HttpResponse.json(endpoint())
    }),
  )
  return calls
}

describe('catalog index', () => {
  it('lists integrations with name, key, prefix and endpoint count', async () => {
    mockApi({ endpoints: [endpoint(), endpoint({ key: 'b' })] })
    await renderApp(<CatalogPage />)
    const link = await screen.findByRole('link', { name: /NIC/ })
    expect(link.getAttribute('href')).toBe('/integrations/nic')
    expect(within(link).getByText('nic')).toBeTruthy()
    expect(within(link).getByText('/nic')).toBeTruthy()
    await within(link).findByText('2 endpoints')
    expect(screen.getByText('// 1 integration')).toBeTruthy()
  })

  it('adds an integration with PUT on the key path and no server fields', async () => {
    const calls = mockApi()
    await renderApp(<CatalogPage />)
    const ue = userEvent.setup()
    await screen.findByRole('link', { name: /NIC/ })
    await ue.click(screen.getByRole('button', { name: 'Add integration' }))
    const dialog = await screen.findByRole('dialog')
    await ue.type(within(dialog).getByLabelText('Key'), 'billing')
    await ue.type(within(dialog).getByLabelText('Name'), 'Billing')
    await ue.clear(within(dialog).getByLabelText('URL prefix'))
    await ue.type(within(dialog).getByLabelText('URL prefix'), '/bill')
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/integrations/billing', csrf: 'csrf-1', ifNoneMatch: '*' })
    expect(calls[0]!.body).toEqual({ name: 'Billing', prefix: '/bill' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await screen.findByText('Integration saved')
  })

  it('puts a 400 message on the field it names and keeps the dialog open', async () => {
    mockApi({ put: () => HttpResponse.json({ error: 'prefix must start with /' }, { status: 400 }) })
    await renderApp(<CatalogPage />)
    const ue = userEvent.setup()
    await screen.findByRole('link', { name: /NIC/ })
    await ue.click(screen.getByRole('button', { name: 'Add integration' }))
    const dialog = await screen.findByRole('dialog')
    await ue.type(within(dialog).getByLabelText('Key'), 'billing')
    await ue.type(within(dialog).getByLabelText('Name'), 'Billing')
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }))
    const prefix = within(dialog).getByLabelText('URL prefix')
    await waitFor(() => expect(prefix.getAttribute('aria-invalid')).toBe('true'))
    expect(within(dialog).getByText('prefix must start with /')).toBeTruthy()
    expect(prefix.getAttribute('aria-describedby')).toContain('prefix-error')
  })

  it('refuses to add an integration over an existing key, without sending the PUT', async () => {
    const calls = mockApi()
    await renderApp(<CatalogPage />)
    const ue = userEvent.setup()
    await screen.findByRole('link', { name: /NIC/ })
    await ue.click(screen.getByRole('button', { name: 'Add integration' }))
    const dialog = await screen.findByRole('dialog')
    await ue.type(within(dialog).getByLabelText('Key'), 'nic')
    await ue.type(within(dialog).getByLabelText('Name'), 'Other')
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }))
    await within(dialog).findByText('An integration with this key already exists')
    expect(within(dialog).getByLabelText('Key').getAttribute('aria-invalid')).toBe('true')
    expect(calls).toHaveLength(0)
  })

  it('puts a 409 from the create-only PUT on the key field even while the list is still loading', async () => {
    const calls = mockApi({ put: () => HttpResponse.json({ error: 'An integration with this key already exists' }, { status: 409 }) })
    let release = () => {}
    const pending = new Promise<void>((resolve) => (release = resolve))
    server.use(http.get(`${BASE}/api/integrations`, async () => (await pending, HttpResponse.json([integration]))))
    await renderApp(<CatalogPage />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Add integration' }))
    const dialog = await screen.findByRole('dialog')
    await ue.type(within(dialog).getByLabelText('Key'), 'nic')
    await ue.type(within(dialog).getByLabelText('Name'), 'Other')
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }))
    const key = within(dialog).getByLabelText('Key')
    await waitFor(() => expect(key.getAttribute('aria-invalid')).toBe('true'))
    expect(within(dialog).getByText('An integration with this key already exists')).toBeTruthy()
    expect(key.getAttribute('aria-describedby')).toContain('key-error')
    expect(calls).toEqual([expect.objectContaining({ method: 'PUT', path: '/api/integrations/nic', ifNoneMatch: '*' })])
    expect(screen.getByRole('dialog')).toBeTruthy()
    release()
    await screen.findByRole('link', { name: /NIC/, hidden: true })
  })

  it('shows an empty state that invites adding the system the app calls', async () => {
    mockApi({ integrations: [] })
    await renderApp(<CatalogPage />)
    await screen.findByText('Add the system your app calls')
    expect(screen.getAllByRole('button', { name: 'Add integration' })).toHaveLength(2)
  })
})

describe('integration page', () => {
  it('lists endpoints with method, full URL, lookup, statuses and a New mock link that preselects it', async () => {
    mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    await screen.findByText('Fetch citizen')
    expect(screen.getByText('POST')).toBeTruthy()
    expect(screen.getByText('/nic/citizens')).toBeTruthy()
    expect(screen.getByText('jsonPath · $.idNo')).toBeTruthy()
    expect(screen.getByText('404')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'New mock for Fetch citizen' })
    const href = new URL(link.getAttribute('href')!, BASE)
    expect(href.pathname).toBe('/mocks/new')
    expect(href.searchParams.get('integration')).toBe('nic')
    expect(href.searchParams.get('endpoint')).toBe('get-citizen')
  })

  it('a long endpoint list shows 50 at a time with Show more', async () => {
    mockApi({ endpoints: Array.from({ length: 120 }, (_, i) => endpoint({ key: `e-${i}`, name: `Endpoint ${i}` })) })
    await renderApp(<IntegrationPage integrationKey="nic" />)
    await screen.findByText('Endpoint 49')
    expect(screen.queryByText('Endpoint 50')).toBeNull()
    expect(screen.getByText('Showing 50 of 120 endpoints')).toBeTruthy()
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Show 50 more' }))
    expect(screen.getByText('Endpoint 99')).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Show 20 more' }))
    expect(screen.getByText('Endpoint 119')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull()
  })

  it('shows the server message when deleting an endpoint that still has mocks, then deletes a clean one', async () => {
    let attempts = 0
    server.use(
      http.delete(`${BASE}/api/integrations/nic/endpoints/get-citizen`, () => {
        attempts++
        return attempts === 1 ? HttpResponse.json({ error: 'Endpoint still has mocks' }, { status: 409 }) : new HttpResponse(null, { status: 204 })
      }),
    )
    mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Delete Fetch citizen' }))
    const dialog = await screen.findByRole('alertdialog')
    await ue.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await within(dialog).findByText('Endpoint still has mocks')
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    await ue.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(attempts).toBe(2)
  })

  it('shows the server message when deleting an integration that still has mocks', async () => {
    server.use(http.delete(`${BASE}/api/integrations/nic`, () => HttpResponse.json({ error: 'Integration still has mocks' }, { status: 409 })))
    mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByText('Fetch citizen')
    await ue.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await ue.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await within(dialog).findByText('Integration still has mocks')
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('edits an integration: key is fixed, body omits key, updatedAt and updatedBy', async () => {
    const calls = mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByText('Fetch citizen')
    await ue.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    const key = within(dialog).getByLabelText('Key') as HTMLInputElement
    expect(key.disabled).toBe(true)
    expect(key.value).toBe('nic')
    await ue.type(within(dialog).getByLabelText('Name'), ' v2')
    await ue.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/integrations/nic', ifNoneMatch: null })
    expect(calls[0]!.body).toEqual({ name: 'NIC v2', prefix: '/nic', description: 'Civil registry' })
  })

  it('offers edit and delete of the integration to any signed-in user', async () => {
    mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    await screen.findByText('Fetch citizen')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add endpoint' })).toBeTruthy()
  })

  it('says so when the integration does not exist', async () => {
    mockApi()
    await renderApp(<IntegrationPage integrationKey="nope" />)
    await screen.findByText('Integration not found')
  })
})

describe('how it fits together', () => {
  afterEach(() => localStorage.clear())

  it('explains integration, endpoint and mock with the NIC example, and stays hidden once dismissed', async () => {
    mockApi()
    await renderApp(<CatalogPage />)
    const strip = await screen.findByRole('region', { name: 'How it fits together' })
    for (const word of ['Integration', 'Endpoint', 'Mock']) expect(within(strip).getByRole('heading', { name: word })).toBeTruthy()
    expect(within(strip).getByText('POST /nic/citizens/fetch')).toBeTruthy()
    const ue = userEvent.setup()
    await ue.click(within(strip).getByRole('button', { name: 'Hide this explainer' }))
    expect(screen.queryByRole('region', { name: 'How it fits together' })).toBeNull()
    expect(localStorage.getItem('wmui.catalogExplainer.dismissed')).toBe('1')
    // It can be brought back from the header.
    await ue.click(screen.getByRole('button', { name: 'How it fits together' }))
    expect(await screen.findByRole('region', { name: 'How it fits together' })).toBeTruthy()
  })

  it('starts hidden when this browser dismissed it before', async () => {
    localStorage.setItem('wmui.catalogExplainer.dismissed', '1')
    mockApi()
    await renderApp(<CatalogPage />)
    await screen.findByRole('link', { name: /NIC/ })
    expect(screen.queryByRole('region', { name: 'How it fits together' })).toBeNull()
  })
})

describe('integration page endpoint actions', () => {
  it('links Add endpoint and Edit to the endpoint pages', async () => {
    mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    await screen.findByText('Fetch citizen')
    expect(screen.getByRole('link', { name: 'Add endpoint' }).getAttribute('href')).toBe('/integrations/nic/endpoints/new')
    expect(screen.getByRole('link', { name: 'Edit Fetch citizen' }).getAttribute('href')).toBe('/integrations/nic/endpoints/get-citizen/edit')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Try it opens the test panel with the example request', async () => {
    mockApi({ endpoints: [endpoint({ exampleRequest: '{"idNo":"1012345678"}' })] })
    server.use(http.get(`${BASE}/api/config`, () => HttpResponse.json({ wiremockPublicUrl: 'http://wm:8080', storeDriver: 'sqlite' })))
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Try it: Fetch citizen' }))
    const panel = await screen.findByRole('dialog', { name: 'Try this endpoint' })
    expect((within(panel).getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe('/nic/citizens')
    expect(within(panel).getByRole('combobox', { name: 'Method' }).textContent).toContain('POST')
    expect((within(panel).getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement).value).toBe('{"idNo":"1012345678"}')
  })
})

describe('endpoint page', () => {
  it('adds an endpoint with the create-only PUT, then goes back to the integration with a New mock action', async () => {
    const calls = mockApi({ endpoints: [] })
    const { router } = await renderApp(<EndpointPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'Add endpoint' })
    await ue.type(screen.getByLabelText('Endpoint ID'), 'get-citizen')
    await ue.type(screen.getByLabelText('Name'), 'Fetch citizen')
    await ue.clear(screen.getByLabelText('Path'))
    await ue.type(screen.getByLabelText('Path'), '/citizens/{{id}')
    await ue.click(screen.getByRole('radio', { name: 'Template' }))
    await ue.click(screen.getByRole('combobox', { name: 'Where the key is' }))
    await ue.click(await screen.findByRole('option', { name: 'Path variable' }))
    await ue.type(screen.getByLabelText('Key expression'), 'id')
    await ue.type(screen.getByLabelText('Add status'), '200')
    await ue.click(screen.getByRole('button', { name: 'Add status' }))
    await ue.type(screen.getByLabelText('Add status'), '404{Enter}')
    await ue.click(screen.getByRole('button', { name: 'Save endpoint' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/integrations/nic/endpoints/get-citizen', ifNoneMatch: '*' })
    expect(calls[0]!.body).toEqual({
      name: 'Fetch citizen',
      method: 'GET',
      path: '/citizens/{id}',
      pathType: 'template',
      lookup: { location: 'path', expression: 'id' },
      contentType: 'json',
      exampleResponses: {},
      allowedStatuses: [200, 404],
    })
    await screen.findByText('integration page nic')
    await screen.findByText('Endpoint Fetch citizen saved')
    await ue.click(screen.getByRole('button', { name: 'New mock from this endpoint' }))
    await screen.findByText(/new mock page/)
    expect(router.state.location.search).toEqual({ integration: 'nic', endpoint: 'get-citizen' })
  })

  it('previews the picker row and key label testers will see, live', async () => {
    mockApi({ endpoints: [] })
    await renderApp(<EndpointPage integrationKey="nic" />)
    const ue = userEvent.setup()
    const preview = await screen.findByRole('region', { name: 'How testers will see this' })
    expect(within(preview).getByText('No key: every mock of this endpoint answers every request.')).toBeTruthy()
    await ue.type(screen.getByLabelText('Name'), 'Fetch citizen')
    await ue.clear(screen.getByLabelText('Path'))
    await ue.type(screen.getByLabelText('Path'), '/citizens/fetch')
    await ue.click(screen.getByRole('combobox', { name: 'Method' }))
    await ue.click(await screen.findByRole('option', { name: 'POST' }))
    await ue.click(screen.getByRole('combobox', { name: 'Where the key is' }))
    await ue.click(await screen.findByRole('option', { name: 'JSON body (JSONPath)' }))
    await ue.type(screen.getByLabelText('Key expression'), '$.idNo')
    expect(within(preview).getByText('Fetch citizen')).toBeTruthy()
    expect(within(preview).getByText('/nic')).toBeTruthy()
    expect(within(preview).getByText('/citizens/fetch')).toBeTruthy()
    expect(within(preview).getByText('POST')).toBeTruthy()
    expect(within(preview).getByText('Value of $.idNo in the request body')).toBeTruthy()
  })

  it('explains each path type and key location with an example', async () => {
    mockApi({ endpoints: [] })
    await renderApp(<EndpointPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByText(/must equal this text/)
    await ue.click(screen.getByRole('radio', { name: 'Template' }))
    expect(screen.getByText(/\/citizens\/\{id\} matches \/nic\/citizens\/42/)).toBeTruthy()
    await ue.click(screen.getByRole('radio', { name: 'Regex' }))
    expect(screen.getByText(/regular expression/)).toBeTruthy()
    const where = screen.getByRole('combobox', { name: 'Where the key is' })
    const cases: [string, string, RegExp][] = [
      ['JSON body (JSONPath)', '$.idNo', /\{"idNo":"1012345678"\}/],
      ['XML body (XPath)', '/Envelope/Body/id', /<id>1012345678<\/id>/],
      ['Query parameter', 'id', /\?id=1012345678/],
      ['Path variable', 'id', /the key id reads 42/],
      ['Header', 'X-Account-Id', /X-Account-Id: 1012345678/],
      ['Form field', 'accountId', /accountId=1012345678/],
    ]
    for (const [option, placeholder, example] of cases) {
      await ue.click(where)
      await ue.click(await screen.findByRole('option', { name: option }))
      expect(screen.getByLabelText('Key expression').getAttribute('placeholder')).toBe(placeholder)
      expect(screen.getByText(example)).toBeTruthy()
    }
  })

  it('edits an endpoint: key is locked, plain PUT, example tabs per status, server fields left out', async () => {
    const calls = mockApi()
    await renderApp(<EndpointPage integrationKey="nic" endpointKey="get-citizen" />)
    const ue = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'Edit endpoint' })
    const key = screen.getByLabelText('Endpoint ID') as HTMLInputElement
    expect(key.disabled).toBe(true)
    expect(key.value).toBe('get-citizen')
    expect(screen.getByRole('tab', { name: '200' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '404' })).toBeTruthy()
    await ue.type(screen.getByLabelText('Name'), ' v2')
    await ue.click(screen.getByRole('button', { name: 'Save endpoint' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    const body = calls[0]!.body as Record<string, unknown>
    expect(body.name).toBe('Fetch citizen v2')
    expect(calls[0]!.ifNoneMatch).toBeNull()
    expect(body.exampleResponses).toEqual({ '200': '{"name":"Sara"}' })
    for (const field of ['updatedAt', 'updatedBy', 'integration', 'key']) expect(body).not.toHaveProperty(field)
    await screen.findByText('integration page nic')
  })

  it('puts a 400 message on the field it names and stays on the page', async () => {
    mockApi({ put: () => HttpResponse.json({ error: 'lookup.expression for jsonPath must start with $' }, { status: 400 }) })
    await renderApp(<EndpointPage integrationKey="nic" endpointKey="get-citizen" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Save endpoint' }))
    const expression = screen.getByLabelText('Key expression')
    await waitFor(() => expect(expression.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByText('lookup.expression for jsonPath must start with $')).toBeTruthy()
    expect(screen.queryByText('integration page nic')).toBeNull()
  })

  it('refuses to add an endpoint over an existing key, without sending the PUT', async () => {
    const calls = mockApi()
    await renderApp(<EndpointPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'Add endpoint' })
    await waitFor(() => expect(screen.getByLabelText('Endpoint ID')).toBeTruthy())
    await ue.type(screen.getByLabelText('Endpoint ID'), 'get-citizen')
    await ue.type(screen.getByLabelText('Name'), 'Dup')
    await ue.click(screen.getByRole('button', { name: 'Save endpoint' }))
    await screen.findByText('An endpoint with this ID already exists. Pick another ID.')
    expect(calls).toHaveLength(0)
  })

  it('puts a 409 from the create-only PUT on the key field when the cached list is stale', async () => {
    const calls = mockApi({ endpoints: [], put: () => HttpResponse.json({ error: 'An endpoint with this key already exists' }, { status: 409 }) })
    await renderApp(<EndpointPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'Add endpoint' })
    await ue.type(screen.getByLabelText('Endpoint ID'), 'get-citizen')
    await ue.type(screen.getByLabelText('Name'), 'Dup')
    await ue.click(screen.getByRole('button', { name: 'Save endpoint' }))
    const key = screen.getByLabelText('Endpoint ID')
    await waitFor(() => expect(key.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByText('An endpoint with this ID already exists. Pick another ID.')).toBeTruthy()
    expect(calls).toEqual([expect.objectContaining({ method: 'PUT', ifNoneMatch: '*' })])
  })

  it('asks before leaving with unsaved changes', async () => {
    mockApi({ endpoints: [] })
    await renderApp(<EndpointPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByRole('heading', { level: 1, name: 'Add endpoint' })
    await ue.type(screen.getByLabelText('Name'), 'Draft')
    await ue.click(screen.getByRole('link', { name: 'Back to NIC' }))
    const dialog = await screen.findByRole('alertdialog')
    await ue.click(within(dialog).getByRole('button', { name: 'Stay' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Add endpoint' })).toBeTruthy()
    await ue.click(screen.getByRole('link', { name: 'Back to NIC' }))
    await ue.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }))
    await screen.findByText('integration page nic')
  })

  it('says so when the endpoint does not exist', async () => {
    mockApi()
    await renderApp(<EndpointPage integrationKey="nic" endpointKey="nope" />)
    await screen.findByText('Endpoint not found')
  })
})

describe('mock editor: about this endpoint', () => {
  it('explains the key in plain words', async () => {
    await renderApp(<EndpointInfo integration={integration} endpoint={endpoint()} />)
    expect(
      screen.getByText(
        'Mocks of this endpoint are told apart by the value of $.idNo in the JSON body. A mock with a key value answers only requests that carry that value; the default mock answers the rest.',
      ),
    ).toBeTruthy()
  })

  it('says when the endpoint has no key', async () => {
    await renderApp(<EndpointInfo integration={integration} endpoint={endpoint({ lookup: undefined })} />)
    expect(screen.getByText('This endpoint has no key: a mock of it answers every request to it.')).toBeTruthy()
  })
})
