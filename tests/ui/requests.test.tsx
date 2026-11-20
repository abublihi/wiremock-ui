import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestsPage, type RequestsSearch } from '@/routes/_app/requests'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { BASE, jsonText } from './editor-fixtures'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
  vi.useRealTimers()
  visibility = 'visible' // no event: the page under test is still mounted here
})
afterAll(() => server.close())

type Row = {
  id: string
  loggedAt: string
  method: string
  url: string
  status: number | null
  matched: boolean
  stubId: string | null
  stubName: string | null
  integration: string | null
  durationMs: number | null
}
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  loggedAt: '2026-11-20T10:00:00.000Z',
  method: 'GET',
  url: `/pay/${id}`,
  status: 200,
  matched: true,
  stubId: `stub-${id}`,
  stubName: `Mock ${id}`,
  integration: 'pay',
  durationMs: 12,
  ...over,
})
const unmatched = (id: string, over: Partial<Row> = {}) =>
  row(id, { matched: false, status: 404, stubId: null, stubName: null, ...over })

const integrations = [{ key: 'pay', name: 'Payments', prefix: '/pay', updatedAt: '', updatedBy: '' }]

/** Serves `pages` in order (the last one repeats) and records every list call. */
function mockList(pages: Row[][]) {
  const calls: URLSearchParams[] = []
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json(integrations)),
    http.get(`${BASE}/api/requests`, ({ request }) => {
      calls.push(new URL(request.url).searchParams)
      return HttpResponse.json(pages[Math.min(calls.length - 1, pages.length - 1)])
    }),
  )
  return calls
}

let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
}

let lastSearch: RequestsSearch = {}
function Harness({ initial = {} }: { initial?: RequestsSearch }) {
  const [search, setSearch] = useState<RequestsSearch>(initial)
  lastSearch = search
  return <RequestsPage search={search} onSearchChange={(next) => setSearch((s) => ({ ...s, ...next }))} />
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('request table', () => {
  it('links a matched row to its mock and stamps an unmatched one', async () => {
    mockList([[unmatched('b', { url: '/pay/refund', method: 'POST' }), row('a')]])
    await renderApp(<Harness />)
    const link = await screen.findByRole('link', { name: 'Mock a' })
    expect(link.getAttribute('href')).toBe('/mocks/stub-a')
    const stamp = screen.getByRole('button', { name: /No match/ })
    expect(stamp.className).toContain('hatch')
    expect(screen.getByText('/pay/refund')).toBeTruthy()
    expect(screen.getAllByText('12 ms')).toHaveLength(2)
    expect(screen.getByText('// 2 requests · 1 without a match')).toBeTruthy()
  })

  it('passes the filters to the API', async () => {
    const calls = mockList([[]])
    await renderApp(<Harness initial={{ matched: 'false', integration: 'pay', status: '404', q: 'refund' }} />)
    await screen.findByText('No requests match these filters')
    const params = calls[0]!
    expect(Object.fromEntries(params)).toMatchObject({ matched: 'false', integration: 'pay', status: '404', q: 'refund' })
    expect(params.has('since')).toBe(false)
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Matched' }))
    expect(lastSearch.matched).toBe('true')
  })

  it('a time range asks only for recent requests', async () => {
    const calls = mockList([[]])
    const before = Date.now()
    await renderApp(<Harness initial={{ range: '15m' }} />)
    await screen.findByText('No requests match these filters')
    const since = Date.parse(calls[0]!.get('since')!)
    expect(since).toBeGreaterThanOrEqual(before - 15 * 60_000 - 1000)
    expect(since).toBeLessThanOrEqual(Date.now() - 15 * 60_000 + 1000)
  })
})

describe('live polling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  it('polls every 2 s with since = the newest row, and merges new rows on top', async () => {
    const calls = mockList([
      [row('a', { loggedAt: '2026-11-20T10:00:01.500Z' }), row('old', { loggedAt: '2026-11-20T10:00:00.000Z' })],
      [unmatched('b', { loggedAt: '2026-11-20T10:00:02.000Z' }), row('a', { loggedAt: '2026-11-20T10:00:01.500Z' })],
      [],
    ])
    await renderApp(<Harness />)
    await screen.findByRole('link', { name: 'Mock a' })
    expect(calls).toHaveLength(1)
    expect(screen.getAllByRole('row').some((r) => r.className.includes('live-flash'))).toBe(false)

    await tick(2000)
    await waitFor(() => expect(calls).toHaveLength(2))
    // One millisecond back, so a request logged in the same millisecond is not skipped (rows merge by id).
    expect(calls[1]!.get('since')).toBe('2026-11-20T10:00:01.499Z')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(4)) // header + b, a, old
    expect(within(screen.getAllByRole('row')[1]!).getByRole('button', { name: /No match/ })).toBeTruthy()
    expect(screen.getAllByRole('row')[1]!.className).toContain('live-flash')

    await tick(2000)
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2]!.get('since')).toBe('2026-11-20T10:00:01.999Z')
  })

  it('the first request into an empty log flashes too; rows on page load do not', async () => {
    mockList([[], [row('a', { loggedAt: '2026-11-20T10:00:05.000Z' })]])
    await renderApp(<Harness />)
    await screen.findByText('No requests yet')
    await tick(2000)
    const link = await screen.findByRole('link', { name: 'Mock a' })
    expect(link.closest('tr')!.className).toContain('live-flash')
  })

  it('pauses when the tab is hidden and resumes with since when it is visible again', async () => {
    const calls = mockList([[row('a', { loggedAt: '2026-11-20T10:00:05.000Z' })], []])
    await renderApp(<Harness />)
    await screen.findByRole('link', { name: 'Mock a' })

    act(() => setVisibility('hidden'))
    await tick(10_000)
    expect(calls).toHaveLength(1)

    act(() => setVisibility('visible'))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]!.get('since')).toBe('2026-11-20T10:00:04.999Z')
    await tick(2000)
    await waitFor(() => expect(calls).toHaveLength(3))
  })

  it('"Pause live" stops polling until resumed', async () => {
    const calls = mockList([[row('a')], []])
    await renderApp(<Harness />)
    await screen.findByRole('link', { name: 'Mock a' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: 'Pause live' }))
    expect(screen.getByText('Paused')).toBeTruthy()
    await tick(8000)
    expect(calls).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Resume live' }))
    await tick(2000)
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
  })
})

describe('clear log', () => {
  it('is offered to every signed-in user and empties the table after confirming', async () => {
    let cleared = false
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json(integrations)),
      http.get(`${BASE}/api/requests`, () => HttpResponse.json(cleared ? [] : [row('a')])),
      http.delete(`${BASE}/api/requests`, ({ request }) => {
        expect(request.headers.get('X-CSRF-Token')).toBe('csrf-1')
        cleared = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await renderApp(<Harness />)
    await screen.findByRole('link', { name: 'Mock a' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Clear log' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear the request log?' })
    await user.click(within(dialog).getByRole('button', { name: 'Clear log' }))
    await screen.findByText('No requests yet')
    expect(cleared).toBe(true)
    expect(screen.queryByRole('link', { name: 'Mock a' })).toBeNull()
  })
})

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'b',
  wasMatched: false,
  request: {
    url: '/pay/refund?x=1',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Trace': '7' },
    body: '{"amount":12}',
    loggedDateString: '2026-11-20T10:00:02.000Z',
  },
  response: { status: 404, headers: { 'Matched-Stub-Id': 'none' }, body: 'Request was not matched' },
  timing: { totalTime: 9 },
  ...over,
})

const misses = [
  {
    stub: { id: 'stub-refund', name: 'Refund ok', owner: 'omar', integration: 'pay' },
    distance: 0.12,
    diffs: [
      { field: 'method', expected: 'equalTo POST', actual: 'POST', matched: true },
      { field: 'urlPath', expected: 'equalTo /pay/refunds', actual: '/pay/refund', matched: false },
      { field: 'body', expected: 'matchesXPath //a', actual: null, matched: null },
    ],
  },
  { stub: { id: 'stub-2', name: null, owner: null, integration: null }, distance: 0.4, diffs: [] },
]

function mockDetail(nearMisses: unknown[] = misses) {
  const calls = mockList([[unmatched('b', { url: '/pay/refund?x=1', method: 'POST' })]])
  server.use(
    http.get(`${BASE}/api/requests/b`, () => HttpResponse.json(detail())),
    http.get(`${BASE}/api/requests/b/near-misses`, () => HttpResponse.json(nearMisses)),
  )
  return calls
}

describe('request drawer', () => {
  it('opens from the No match stamp and shows the request and the response', async () => {
    mockDetail()
    await renderApp(<Harness />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /No match/ }))
    expect(lastSearch.open).toBe('b')
    const drawer = await screen.findByRole('dialog')
    const request = await within(drawer).findByRole('region', { name: 'Request' })
    expect(within(request).getByText('X-Trace')).toBeTruthy()
    expect(within(request).getByText('7')).toBeTruthy()
    expect(within(request).getByText(/"amount": 12/)).toBeTruthy() // pretty-printed
    const response = within(drawer).getByRole('region', { name: 'Response' })
    expect(within(response).getByText('404')).toBeTruthy()
    expect(within(response).getByText('Request was not matched')).toBeTruthy()
    expect(within(drawer).getByText('9 ms')).toBeTruthy()
  })

  it('"Create mock from this request" links to the prefilled editor', async () => {
    mockDetail()
    await renderApp(<Harness initial={{ open: 'b' }} />)
    const create = await screen.findByRole('link', { name: 'Create mock from this request' })
    expect(create.getAttribute('href')).toBe('/mocks/new?from=b')
  })

  it('explains the near misses: mismatches first, highlighted; unchecked rows say why', async () => {
    mockDetail()
    await renderApp(<Harness initial={{ open: 'b' }} />)
    const panel = await screen.findByRole('region', { name: 'Near misses' })
    const card = await within(panel).findByRole('article', { name: 'Refund ok' })
    expect(within(card).getByRole('link', { name: 'Refund ok' }).getAttribute('href')).toBe('/mocks/stub-refund')
    expect(within(card).getByText('omar')).toBeTruthy()
    expect(within(card).getByText('1 of 3 fields differ')).toBeTruthy()

    const rows = within(card).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['mismatch', 'match', 'unchecked'])
    expect(within(rows[0]!).getByText('urlPath')).toBeTruthy()
    expect(within(rows[0]!).getByText('equalTo /pay/refunds')).toBeTruthy()
    expect(within(rows[0]!).getByText('/pay/refund')).toBeTruthy()
    expect(within(rows[0]!).getByText('Mismatch')).toBeTruthy()
    expect(within(rows[1]!).getByText('Match')).toBeTruthy()
    expect(within(rows[2]!).getByText("Simple checks can't evaluate this matcher")).toBeTruthy()

    expect(within(panel).getByRole('article', { name: 'Unnamed mock' })).toBeTruthy()
  })

  it('says so when no mock comes close', async () => {
    mockDetail([])
    await renderApp(<Harness initial={{ open: 'b' }} />)
    expect(await screen.findByText('No mock comes close. Create one from this request.')).toBeTruthy()
  })

  it('a matched request shows the mock it matched instead of near misses', async () => {
    mockList([[row('a')]])
    server.use(
      http.get(`${BASE}/api/requests/a`, () =>
        HttpResponse.json(detail({ id: 'a', wasMatched: true, stubMapping: { id: 'stub-a', name: 'Mock a', request: {}, response: {} } })),
      ),
    )
    await renderApp(<Harness initial={{ open: 'a' }} />)
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByRole('link', { name: 'Mock a' })).toBeTruthy()
    expect(within(drawer).queryByRole('region', { name: 'Near misses' })).toBeNull()
  })
})

describe('new mock from a request', () => {
  function NewHarness() {
    const [search, setSearch] = useState<NewMockSearch>({ from: 'b' })
    return <NewMockPage search={search} onSearchChange={setSearch} />
  }

  it('opens Advanced with the method, path and JSON body prefilled, and creates with POST', async () => {
    let created: unknown
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json(integrations)),
      http.get(`${BASE}/api/requests/b`, () => HttpResponse.json(detail())),
      http.post(`${BASE}/api/mocks`, async ({ request }) => {
        created = await request.json()
        return HttpResponse.json({ id: 'new-1', ...(created as object) }, { status: 201 })
      }),
    )
    const { router } = await renderApp(<NewHarness />)
    await screen.findByRole('tab', { name: 'Advanced', selected: true })
    await waitFor(() => expect(jsonText()).toContain('/pay/refund'))
    expect(JSON.parse(jsonText())).toEqual({
      request: { method: 'POST', urlPath: '/pay/refund', bodyPatterns: [{ equalToJson: { amount: 12 } }] },
      response: { status: 200 },
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() => expect(created).toBeTruthy())
    expect(created).toMatchObject({ request: { method: 'POST', urlPath: '/pay/refund' }, response: { status: 200 } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/new-1'))
  })
})

describe('count tool', () => {
  it('counts calls for a method and URL path', async () => {
    mockList([[]])
    let body: unknown
    server.use(
      http.post(`${BASE}/api/requests/count`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ count: 3 })
      }),
    )
    await renderApp(<Harness />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Count calls' }))
    const dialog = await screen.findByRole('dialog', { name: 'Count calls' })
    await user.type(within(dialog).getByRole('textbox', { name: 'URL path' }), '/pay/charge')
    await user.click(within(dialog).getByRole('button', { name: 'Count' }))
    expect(await within(dialog).findByText('Called 3 times')).toBeTruthy()
    expect(body).toEqual({ pattern: { method: 'GET', urlPath: '/pay/charge' } })
  })
})
