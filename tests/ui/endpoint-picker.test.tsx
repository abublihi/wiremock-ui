import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { EndpointPicker, PICKER_LIMIT } from '@/ui/components/editor/EndpointPicker'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const integration = (key: string, name: string): Integration => ({ key, name, prefix: `/${key}`, updatedAt: '', updatedBy: '' })
const endpoint = (integration: string, i: number): Endpoint => ({
  integration,
  key: `ep-${i}`,
  name: `${integration} endpoint ${i}`,
  method: 'GET',
  path: `/thing/${i}`,
  pathType: 'exact',
  contentType: 'json',
  exampleResponses: {},
  allowedStatuses: [],
  updatedAt: '',
  updatedBy: '',
})

function mockCatalog(catalog: Record<string, number>) {
  const keys = Object.keys(catalog)
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json(keys.map((k) => integration(k, k.toUpperCase())))),
    ...keys.map((k) =>
      http.get(`${BASE}/api/integrations/${k}/endpoints`, () => HttpResponse.json(Array.from({ length: catalog[k]! }, (_, i) => endpoint(k, i)))),
    ),
  )
}

const options = () => screen.queryAllByRole('option')

describe('endpoint picker', () => {
  it(`shows at most ${PICKER_LIMIT} endpoints and says how many more there are`, async () => {
    mockCatalog({ alpha: 40, beta: 30 })
    await renderApp(<EndpointPicker onPick={() => {}} />)
    await screen.findByText('Showing 50 of 70 — type to narrow')
    expect(options()).toHaveLength(PICKER_LIMIT)
    expect(screen.getByText('ALPHA')).toBeTruthy()
    expect(screen.getByText('BETA')).toBeTruthy()
  })

  it('typing narrows the matches and the footer goes once they all fit', async () => {
    mockCatalog({ alpha: 40, beta: 30 })
    await renderApp(<EndpointPicker onPick={() => {}} />)
    await screen.findByText('Showing 50 of 70 — type to narrow')
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search endpoints' }), 'beta')
    await waitFor(() => expect(options()).toHaveLength(30))
    expect(screen.queryByText(/type to narrow/)).toBeNull()
    expect(screen.queryByText('ALPHA')).toBeNull()
  })

  it('every search word must match: integration, name, method or full path', async () => {
    mockCatalog({ alpha: 40, beta: 30 })
    await renderApp(<EndpointPicker onPick={() => {}} />)
    await screen.findByText('Showing 50 of 70 — type to narrow')
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search endpoints' }), '/beta/thing/12 get')
    await waitFor(() => expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('beta endpoint 12')]))
  })

  it('hides integrations that have no endpoints', async () => {
    mockCatalog({ alpha: 2, empty: 0 })
    await renderApp(<EndpointPicker onPick={() => {}} />)
    await waitFor(() => expect(options()).toHaveLength(2))
    expect(screen.queryByText('EMPTY')).toBeNull()
  })

  it('says so when no integration has an endpoint yet', async () => {
    mockCatalog({ empty: 0, bare: 0 })
    await renderApp(<EndpointPicker onPick={() => {}} />)
    await screen.findByText('// no endpoints yet — add one to an integration in the catalog')
    expect(screen.queryByText('EMPTY')).toBeNull()
  })

  it('keyboard: the first match is selected, arrows move, Enter picks', async () => {
    mockCatalog({ alpha: 3 })
    const onPick = vi.fn()
    await renderApp(<EndpointPicker onPick={onPick} />)
    await waitFor(() => expect(options()).toHaveLength(3))
    const input = screen.getByRole('combobox', { name: 'Search endpoints' })
    const ue = userEvent.setup()
    await ue.click(input)
    await ue.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenLastCalledWith('alpha', 'ep-1')
    await ue.type(input, 'endpoint 2')
    await waitFor(() => expect(options()).toHaveLength(1))
    await ue.keyboard('{Enter}')
    expect(onPick).toHaveBeenLastCalledWith('alpha', 'ep-2')
  })
})
