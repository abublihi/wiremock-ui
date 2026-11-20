import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { CatalogPage } from '@/routes/_app/catalog.index'
import { IntegrationPage } from '@/routes/_app/catalog.$key'
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
    expect(link.getAttribute('href')).toBe('/catalog/nic')
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

  it('shows an empty state with an add button', async () => {
    mockApi({ integrations: [] })
    await renderApp(<CatalogPage />)
    await screen.findByText('No integrations yet')
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

  it('adds an endpoint: lookup shape, path type, statuses and no server fields', async () => {
    const calls = mockApi({ endpoints: [] })
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByText('No endpoints yet')
    await ue.click(screen.getByRole('button', { name: 'Add endpoint' }))
    const sheet = await screen.findByRole('dialog')
    await ue.type(within(sheet).getByLabelText('Key'), 'get-citizen')
    await ue.type(within(sheet).getByLabelText('Name'), 'Fetch citizen')
    await ue.clear(within(sheet).getByLabelText('Path'))
    await ue.type(within(sheet).getByLabelText('Path'), '/citizens/{{id}')
    await ue.click(within(sheet).getByRole('radio', { name: 'Template' }))
    await ue.click(within(sheet).getByRole('combobox', { name: 'Lookup location' }))
    await ue.click(await screen.findByRole('option', { name: 'Path variable' }))
    await ue.type(within(sheet).getByLabelText('Lookup expression'), 'id')
    await ue.type(within(sheet).getByLabelText('Add status'), '200')
    await ue.click(within(sheet).getByRole('button', { name: 'Add status' }))
    await ue.type(within(sheet).getByLabelText('Add status'), '404{Enter}')
    expect(within(sheet).getByText('404')).toBeTruthy()
    await ue.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/integrations/nic/endpoints/get-citizen', ifNoneMatch: '*' })
    await screen.findByText('Endpoint saved')
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
  })

  it('shows the lookup placeholder for the chosen location', async () => {
    mockApi({ endpoints: [] })
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Add endpoint' }))
    const sheet = await screen.findByRole('dialog')
    await ue.click(within(sheet).getByRole('combobox', { name: 'Lookup location' }))
    await ue.click(await screen.findByRole('option', { name: 'JSON body (JSONPath)' }))
    expect(within(sheet).getByLabelText('Lookup expression').getAttribute('placeholder')).toBe('$.idNo')
    await ue.click(within(sheet).getByRole('combobox', { name: 'Lookup location' }))
    await ue.click(await screen.findByRole('option', { name: 'XML body (XPath)' }))
    expect(within(sheet).getByLabelText('Lookup expression').getAttribute('placeholder')).toBe('/Envelope/Body/id')
  })

  it('edits an endpoint: key is fixed, body omits integration, key, updatedAt and updatedBy', async () => {
    const calls = mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Edit Fetch citizen' }))
    const sheet = await screen.findByRole('dialog')
    const key = within(sheet).getByLabelText('Key') as HTMLInputElement
    expect(key.disabled).toBe(true)
    expect(key.value).toBe('get-citizen')
    await ue.type(within(sheet).getByLabelText('Name'), ' v2')
    await ue.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    const body = calls[0]!.body as Record<string, unknown>
    expect(body.name).toBe('Fetch citizen v2')
    expect(calls[0]!.ifNoneMatch).toBeNull()
    expect(body.exampleResponses).toEqual({ '200': '{"name":"Sara"}' })
    for (const field of ['updatedAt', 'updatedBy', 'integration', 'key']) expect(body).not.toHaveProperty(field)
  })

  it('puts a 400 message on the field it names', async () => {
    mockApi({ put: () => HttpResponse.json({ error: 'lookup.expression for jsonPath must start with $' }, { status: 400 }) })
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Edit Fetch citizen' }))
    const sheet = await screen.findByRole('dialog')
    await ue.click(within(sheet).getByRole('button', { name: 'Save' }))
    const expression = within(sheet).getByLabelText('Lookup expression')
    await waitFor(() => expect(expression.getAttribute('aria-invalid')).toBe('true'))
    expect(within(sheet).getByText('lookup.expression for jsonPath must start with $')).toBeTruthy()
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

  it('refuses to add an endpoint over an existing key, without sending the PUT', async () => {
    const calls = mockApi()
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Add endpoint' }))
    const sheet = await screen.findByRole('dialog')
    await ue.type(within(sheet).getByLabelText('Key'), 'get-citizen')
    await ue.type(within(sheet).getByLabelText('Name'), 'Dup')
    await ue.click(within(sheet).getByRole('button', { name: 'Save' }))
    await within(sheet).findByText('An endpoint with this key already exists')
    expect(calls).toHaveLength(0)
  })

  it('puts a 409 from the create-only PUT on the key field when the cached list is stale', async () => {
    const calls = mockApi({ endpoints: [], put: () => HttpResponse.json({ error: 'An endpoint with this key already exists' }, { status: 409 }) })
    await renderApp(<IntegrationPage integrationKey="nic" />)
    const ue = userEvent.setup()
    await screen.findByText('No endpoints yet')
    await ue.click(screen.getByRole('button', { name: 'Add endpoint' }))
    const sheet = await screen.findByRole('dialog')
    await ue.type(within(sheet).getByLabelText('Key'), 'get-citizen')
    await ue.type(within(sheet).getByLabelText('Name'), 'Dup')
    await ue.click(within(sheet).getByRole('button', { name: 'Save' }))
    const key = within(sheet).getByLabelText('Key')
    await waitFor(() => expect(key.getAttribute('aria-invalid')).toBe('true'))
    expect(within(sheet).getByText('An endpoint with this key already exists')).toBeTruthy()
    expect(calls).toEqual([expect.objectContaining({ method: 'PUT', ifNoneMatch: '*' })])
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
    expect(screen.getByRole('button', { name: 'Add endpoint' })).toBeTruthy()
  })

  it('says so when the integration does not exist', async () => {
    mockApi()
    await renderApp(<IntegrationPage integrationKey="nope" />)
    await screen.findByText('Integration not found')
  })
})
