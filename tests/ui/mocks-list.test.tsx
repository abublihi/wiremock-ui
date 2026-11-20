import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MocksPage, type MocksSearch } from '@/routes/_app/mocks.index'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const stub = (id: string, over: { owner?: string; version?: number; method?: string; status?: number; name?: string } = {}) => ({
  id,
  name: over.name ?? `Mock ${id}`,
  request: { method: over.method ?? 'GET', urlPath: `/api/${id}` },
  response: { status: over.status ?? 200 },
  metadata: {
    wiremockUi: {
      owner: over.owner ?? 'sara',
      version: over.version ?? 3,
      integration: 'payments',
      endpoint: 'charge',
      updatedAt: '2026-11-18T10:00:00.000Z',
      updatedBy: over.owner ?? 'sara',
      source: 'ui',
    },
  },
})
const integrations = [{ key: 'payments', name: 'Payments', prefix: '/pay', updatedAt: '', updatedBy: '' }]

type Seen = { url: URL; method: string; body?: unknown }[]
function mockApi(mocks: ReturnType<typeof stub>[], seen: Seen = []) {
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json(integrations)),
    http.get(`${BASE}/api/mocks`, ({ request }) => {
      seen.push({ url: new URL(request.url), method: 'GET' })
      return HttpResponse.json(mocks)
    }),
  )
  return seen
}

let lastSearch: MocksSearch = {}
function Harness({ initial = {} }: { initial?: MocksSearch }) {
  const [search, setSearch] = useState<MocksSearch>(initial)
  lastSearch = search
  return <MocksPage search={search} onSearchChange={(next) => setSearch((s) => ({ ...s, ...next }))} />
}

describe('mock list', () => {
  it('defaults to my mocks and renders the rows', async () => {
    const seen = mockApi([stub('a'), stub('b', { owner: 'baseline', method: 'POST', status: 404 })])
    await renderApp(<Harness />)
    await screen.findByText('Mock a')
    expect(seen[0]!.url.searchParams.get('owner')).toBe('me')
    expect(screen.getByRole('radio', { name: 'My mocks' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Baseline')).toBeTruthy()
    expect(screen.getByText('404')).toBeTruthy()
    expect(screen.getByText('// 2 mocks · 1 baseline')).toBeTruthy()
  })

  it('switching to All mocks updates the search and refetches', async () => {
    const seen = mockApi([stub('a')])
    await renderApp(<Harness />)
    await screen.findByText('Mock a')
    await userEvent.setup().click(screen.getByRole('radio', { name: 'All mocks' }))
    await waitFor(() => expect(seen.some((s) => !s.url.searchParams.has('owner'))).toBe(true))
    expect(lastSearch.owner).toBe('all')
  })

  it('maps the text and status filters to query parameters (text debounced)', async () => {
    const seen = mockApi([stub('a')])
    await renderApp(<Harness initial={{ status: '404', integration: 'payments' }} />)
    await screen.findByText('Mock a')
    const first = seen[0]!.url.searchParams
    expect(first.get('status')).toBe('404')
    expect(first.get('integration')).toBe('payments')
    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search mocks' }), 'refund')
    expect(seen.every((s) => s.url.searchParams.get('q') === null)).toBe(true)
    await waitFor(() => expect(seen.at(-1)!.url.searchParams.get('q')).toBe('refund'))
    expect(lastSearch.q).toBe('refund')
  })

  it('offers every action on every row, baseline included', async () => {
    mockApi([stub('a', { owner: 'baseline' })])
    await renderApp(<Harness />)
    await screen.findByText('Mock a')
    expect(screen.getByRole('link', { name: 'New mock' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset my mocks' })).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Actions for Mock a' }))
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Duplicate to my mocks' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('duplicates a mock', async () => {
    const seen = mockApi([stub('a')])
    server.use(
      http.post(`${BASE}/api/mocks/a/duplicate`, () => {
        seen.push({ url: new URL(`${BASE}/dup`), method: 'POST' })
        return HttpResponse.json(stub('a2'), { status: 201 })
      }),
    )
    await renderApp(<Harness />)
    await screen.findByText('Mock a')
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Actions for Mock a' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Duplicate to my mocks' }))
    await screen.findByText('Mock duplicated')
    expect(seen.some((s) => s.method === 'POST')).toBe(true)
  })

  it('delete confirms, sends the version, and Undo restores that version', async () => {
    mockApi([stub('a', { version: 7 })])
    const calls: { url?: string; restore?: unknown } = {}
    server.use(
      http.delete(`${BASE}/api/mocks/a`, ({ request }) => {
        calls.url = request.url
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${BASE}/api/mocks/a/restore`, async ({ request }) => {
        calls.restore = await request.json()
        return HttpResponse.json(stub('a'))
      }),
    )
    await renderApp(<Harness />)
    await screen.findByText('Mock a')
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Actions for Mock a' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Delete mock “Mock a”\?/)).toBeTruthy()
    expect(within(dialog).getByText(/restore it from history for 7 days/)).toBeTruthy()
    await ue.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await screen.findByText('Mock deleted')
    expect(calls.url).toContain('version=7')
    await ue.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.restore).toEqual({ version: 7 }))
  })

  it('reset my mocks shows the count in the confirm and the result toast', async () => {
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json(integrations)),
      http.get(`${BASE}/api/mocks`, () => HttpResponse.json([stub('a'), stub('b'), stub('c')])),
      http.post(`${BASE}/api/mocks/reset-mine`, () => HttpResponse.json({ deleted: 3 })),
    )
    await renderApp(<Harness />)
    await screen.findByText('Mock a')
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Reset my mocks' }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByText(/Delete your 3 mocks\?/)
    await ue.click(within(dialog).getByRole('button', { name: 'Reset my mocks' }))
    await screen.findByText('Deleted 3 mocks')
  })

  it('empty state for my mocks offers New mock', async () => {
    mockApi([])
    await renderApp(<Harness />)
    await screen.findByText('No mocks yet')
    expect(screen.getAllByRole('link', { name: 'New mock' }).length).toBeGreaterThan(0)
  })

  it('empty state with filters offers Clear filters', async () => {
    mockApi([])
    await renderApp(<Harness initial={{ status: '500' }} />)
    await screen.findByText('Nothing matches these filters')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(lastSearch.status).toBeUndefined()
    expect(lastSearch.owner).toBeUndefined()
  })

  it('shows an error with Retry', async () => {
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json(integrations)),
      http.get(`${BASE}/api/mocks`, () => HttpResponse.json({ error: 'WireMock unreachable' }, { status: 502 })),
    )
    await renderApp(<Harness />)
    await screen.findByText('WireMock unreachable')
    mockApi([stub('a')])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Mock a')
  })
})
