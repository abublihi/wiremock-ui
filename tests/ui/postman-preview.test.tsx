import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { strToU8, zipSync } from 'fflate'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ImportReport } from '@/server/bundle/importer'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { ImportPage } from '@/routes/_app/import'
import { PostmanPreview } from '@/ui/components/admin/PostmanPreview'
import { parsePostman } from '@/ui/lib/postman'
import { ServerConfigProvider } from '@/ui/config'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const shopText = readFileSync(join(process.cwd(), 'tests/fixtures/postman/shop-v2.1.json'), 'utf8')
const file = (content: string, name: string) => new File([content], name, { type: 'application/json' })
const report: ImportReport = { integrations: 1, endpoints: 5, created: 7, updated: 0, unchanged: 0, skipped: [], pruned: 0, ignoredOidcIdentities: 0 }
const stamp = { updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'sara' }
const endpoint = (key: string): Endpoint => ({
  integration: 'shop-api', key, name: key, method: 'GET', path: '/x', pathType: 'exact', contentType: 'json', exampleResponses: {}, allowedStatuses: [], ...stamp,
})

type Bundle = { integrations: unknown[]; catalog: { key: string }[]; mocks: { name: string; metadata: { wiremockUi: { endpoint: string } } }[] }

function mockApi(integrations: Integration[] = [], endpoints: Endpoint[] = []) {
  const calls: { search: string; body: Bundle }[] = []
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json(integrations)),
    http.get(`${BASE}/api/integrations/:key/endpoints`, () => HttpResponse.json(endpoints)),
    http.post(`${BASE}/api/import`, async ({ request }) => {
      calls.push({ search: new URL(request.url).search, body: (await request.json()) as Bundle })
      return HttpResponse.json(report)
    }),
  )
  return calls
}

async function pick(ui: ReactNode = <ImportPage />, files: File[] = [file(shopText, 'shop.postman_collection.json')]) {
  await renderApp(ui)
  const ue = userEvent.setup({ applyAccept: false })
  await ue.upload(screen.getByLabelText('Choose files'), files)
  return ue
}

const preview = () => screen.findByRole('region', { name: /Postman collection: Shop API/ })
const rowOf = (name: string) => within(screen.getByRole('table')).getByText(name, { selector: 'span' }).closest('tr') as HTMLElement

describe('Postman preview on the Import page', () => {
  it('shows the integration fields, one row per request, skipped examples and warnings', async () => {
    mockApi()
    await pick()
    const region = await preview()
    expect(within(region).getByText(/5 requests · 9 saved examples · from shop.postman_collection.json/)).toBeTruthy()
    expect((within(region).getByLabelText('Key') as HTMLInputElement).value).toBe('shop-api')
    expect((within(region).getByLabelText('Name') as HTMLInputElement).value).toBe('Shop API')
    expect((within(region).getByLabelText('Prefix') as HTMLInputElement).value).toBe('/shop-api')
    expect(within(rowOf('Get order')).getByText('/shop-api/api/orders/{orderId}')).toBeTruthy()
    expect(within(rowOf('Get order')).getAllByText('New')).toHaveLength(1)
    expect(within(region).getByText('Examples not imported (1)')).toBeTruthy()
    expect(within(region).getByText(/Pending again/)).toBeTruthy()
    expect(within(region).getByText('Auth helpers are ignored: the mocks answer without checking credentials.')).toBeTruthy()
    expect(within(region).getByText('Pre-request and test scripts are ignored.')).toBeTruthy()
    expect(within(region).getByText('Customer graph: GraphQL bodies are not matched; the mocks answer any body.')).toBeTruthy()
    // No prune option: a Postman import never deletes anything.
    expect(screen.queryByText(/Remove baseline mocks/)).toBeNull()
  })

  it('offers the shared first path segment as the prefix and imports one bundle without prune', async () => {
    const calls = mockApi()
    const ue = await pick()
    const region = await preview()
    await ue.click(within(region).getByRole('button', { name: 'Use /api — every request starts with it' }))
    expect((within(region).getByLabelText('Prefix') as HTMLInputElement).value).toBe('/api')
    expect(within(rowOf('Get order')).getByText('/api/orders/{orderId}')).toBeTruthy()
    await ue.click(within(region).getByRole('button', { name: 'Import 5 endpoints and 8 mocks' }))
    await screen.findByText('Import finished')
    expect(calls).toHaveLength(1)
    expect(calls[0].search).toBe('')
    expect(calls[0].body.integrations).toEqual([{ key: 'shop-api', name: 'Shop API', prefix: '/api', description: 'Orders and customers' }])
    expect(calls[0].body.catalog.map((e) => e.key)).toEqual(['get-order', 'search-orders', 'create-order', 'sign-in', 'customer-graph'])
    expect(calls[0].body.mocks).toHaveLength(8)
    const open = screen.getByRole('link', { name: 'Open Shop API' })
    await ue.click(open)
    await screen.findByText('integration page shop-api')
  })

  it('blocks an invalid key or prefix with a message', async () => {
    mockApi()
    const ue = await pick()
    const region = await preview()
    const key = within(region).getByLabelText('Key')
    await ue.clear(key)
    await ue.type(key, 'Shop API')
    expect(within(region).getByText('1–63 characters: a-z, 0-9 or -, starting with a letter or digit.')).toBeTruthy()
    await ue.clear(key)
    await ue.type(key, 'shop')
    const prefix = within(region).getByLabelText('Prefix')
    await ue.clear(prefix)
    await ue.type(prefix, 'api/')
    expect(within(region).getByText('The prefix must start with /.')).toBeTruthy()
    expect((within(region).getByRole('button', { name: /^Import \d+ endpoints/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the user picks the default answer per endpoint', async () => {
    const calls = mockApi()
    const ue = await pick()
    const region = await preview()
    await ue.click(within(region).getByRole('combobox', { name: 'Default answer for Get order' }))
    await ue.click(await screen.findByRole('option', { name: /Order missing/ }))
    await ue.click(within(region).getByRole('button', { name: /^Import 5 endpoints/ }))
    await screen.findByText('Import finished')
    const get = calls[0].body.mocks.filter((m) => m.metadata.wiremockUi.endpoint === 'get-order') as unknown as { name: string; priority: number }[]
    expect(get.map((m) => [m.name, m.priority])).toEqual([
      ['Get order — Order missing', 10],
      ['Get order — Order found', 5],
    ])
  })

  describe('into an existing integration', () => {
    const shop: Integration = { key: 'shop-api', name: 'Shop (stored)', prefix: '/api', ...stamp }

    it('keeps its name and prefix and marks conflicting keys; Create new renames, Overwrite keeps, Skip drops', async () => {
      const calls = mockApi([shop], [endpoint('get-order'), endpoint('sign-in'), endpoint('create-order')])
      const ue = await pick()
      const region = await preview()
      await within(region).findByText('Adds to the existing integration Shop (stored) (/api). Its name and prefix stay as they are.')
      expect((within(region).getByLabelText('Prefix') as HTMLInputElement).disabled).toBe(true)
      await waitFor(() => expect(within(rowOf('Get order')).getByText('Key exists')).toBeTruthy())
      expect(within(rowOf('Get order')).getByText(/imported as get-order-2/)).toBeTruthy()
      expect(within(rowOf('Search orders')).getByText('New')).toBeTruthy()

      await ue.click(within(region).getByRole('combobox', { name: 'What to do with Sign in' }))
      await ue.click(await screen.findByRole('option', { name: 'Overwrite' }))
      await ue.click(within(region).getByRole('combobox', { name: 'What to do with Create order' }))
      await ue.click(await screen.findByRole('option', { name: 'Skip' }))

      await ue.click(within(region).getByRole('button', { name: 'Import 4 endpoints and 6 mocks' }))
      await screen.findByText('Import finished')
      const body = calls[0].body
      expect(body.integrations).toEqual([])
      expect(body.catalog.map((e) => e.key)).toEqual(['get-order-2', 'search-orders', 'sign-in', 'customer-graph'])
      expect(new Set(body.mocks.map((m) => m.metadata.wiremockUi.endpoint))).toEqual(new Set(['get-order-2', 'search-orders', 'sign-in']))
    })
  })

  it('a failed integrations load blocks the import and says so', async () => {
    const calls = mockApi()
    server.use(http.get(`${BASE}/api/integrations`, () => HttpResponse.json({ error: 'store is down' }, { status: 503 })))
    await pick()
    const region = await preview()
    await within(region).findByText('Could not load the integrations')
    expect((within(region).getByRole('button', { name: /^Import 5 endpoints/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('checks the catalog again before sending: an integration created meanwhile turns rows into conflicts instead of being overwritten', async () => {
    const calls = mockApi()
    const ue = await pick()
    const region = await preview()
    expect(within(rowOf('Get order')).getByText('New')).toBeTruthy()
    // Someone creates the integration (with a get-order endpoint) while this page is open.
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([{ key: 'shop-api', name: 'Shop (theirs)', prefix: '/shop-api', ...stamp }])),
      http.get(`${BASE}/api/integrations/:key/endpoints`, () => HttpResponse.json([endpoint('get-order')])),
    )
    await ue.click(within(region).getByRole('button', { name: 'Import 5 endpoints and 8 mocks' }))
    await waitFor(() => expect(within(rowOf('Get order')).getByText('Key exists')).toBeTruthy())
    expect(calls).toHaveLength(0)
    expect(await within(region).findByText('The integrations changed while you were reviewing. Check the rows marked Key exists, then import again.')).toBeTruthy()
    await within(region).findByText(/Adds to the existing integration Shop \(theirs\)/)
    // Looked at again, the user imports: the integration is not sent and get-order becomes get-order-2.
    await ue.click(within(region).getByRole('button', { name: 'Import 5 endpoints and 8 mocks' }))
    await screen.findByText('Import finished')
    expect(calls[0].body.integrations).toEqual([])
    expect(calls[0].body.catalog[0].key).toBe('get-order-2')
  })

  it('links the name and prefix errors to their fields', async () => {
    mockApi()
    const ue = await pick()
    const region = await preview()
    await ue.clear(within(region).getByLabelText('Name'))
    await ue.clear(within(region).getByLabelText('Prefix'))
    expect(within(region).getByLabelText('Name').getAttribute('aria-describedby')).toBe(within(region).getByText('Give the integration a name.').id)
    const described = within(region).getByLabelText('Prefix').getAttribute('aria-describedby')!.split(' ')
    expect(described).toContain(within(region).getByText('The prefix must start with /.').id)
  })

  it('draws at most 500 rows of a huge collection but imports every request', async () => {
    const calls = mockApi()
    const item = Array.from({ length: 520 }, (_, i) => ({ name: `Req ${i}`, request: { method: 'GET', url: `/r/${i}` } }))
    const big = JSON.stringify({ info: { name: 'Big', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item })
    const ue = await pick(<ImportPage />, [file(big, 'big.json')])
    const region = await screen.findByRole('region', { name: /Postman collection: Big/ })
    expect(within(region).getAllByRole('row')).toHaveLength(501) // header + 500
    expect(within(region).getByText('…and 20 more requests, imported with their defaults.')).toBeTruthy()
    await ue.click(within(region).getByRole('button', { name: 'Import 520 endpoints and 0 mocks' }))
    await screen.findByText('Import finished')
    expect(calls[0].body.catalog).toHaveLength(520)
  })

  it('explains a bundle that cannot be serialised instead of only disabling Import', async () => {
    mockApi()
    const collection = parsePostman(JSON.parse(shopText))
    // A value JSON.stringify refuses (a BigInt) reaches the bundle through the integration description.
    const odd = { ...collection, description: 10n as unknown as string }
    await renderApp(<PostmanPreview collection={odd} fileName="odd.json" onImported={() => {}} onCancel={() => {}} />)
    const region = await preview()
    expect(await within(region).findByText(/The import can't be prepared: the collection holds a value that can't be sent as JSON/)).toBeTruthy()
    expect((within(region).getByRole('button', { name: /^Import 5 endpoints/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('in WireMock-only mode, says the catalog is kept in memory', async () => {
    mockApi()
    await pick(
      <ServerConfigProvider config={{ storeDriver: 'none', wiremockPublicUrl: 'http://localhost:8080' }}>
        <ImportPage />
      </ServerConfigProvider>,
    )
    const region = await preview()
    expect(within(region).getByText(/WireMock-only mode: the mocks go straight into WireMock/)).toBeTruthy()
  })

  it('finds a collection inside a zip; with other files it must be imported on its own', async () => {
    mockApi()
    const zip = zipSync({ 'collections/shop.json': strToU8(shopText), 'mappings/a.json': strToU8(JSON.stringify({ request: { method: 'GET', urlPath: '/a' }, response: { status: 200 } })) })
    const ue = await pick(<ImportPage />, [new File([zip], 'mocks.zip', { type: 'application/zip' })])
    const list = await screen.findByRole('list', { name: 'Files' })
    expect(within(list).getByText('Postman collection · 5 requests')).toBeTruthy()
    expect(screen.getByText(/A Postman collection is imported on its own/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true)
    await ue.click(screen.getByRole('button', { name: 'Remove mocks.zip/mappings/a.json' }))
    await preview()
  })
})
