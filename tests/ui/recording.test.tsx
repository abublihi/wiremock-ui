import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { summaryOf, type Recording } from '@/server/recording/types'
import { RecordingPage } from '@/routes/_app/recording'
import { APP_NAV, navFor } from '@/ui/components/shell/AppShell'
import { RecordingBanner } from '@/ui/components/shell/RecordingBanner'
import { ServerConfigProvider } from '@/ui/config'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const config = (recordingAllowed = true) => ({ storeDriver: 'sqlite' as const, wiremockPublicUrl: 'http://wiremock.test:8080', recordingAllowed, seedPrune: false })
const withConfig = (ui: ReactNode, allowed = true) => <ServerConfigProvider config={config(allowed)}>{ui}</ServerConfigProvider>

const shop: Integration = { key: 'shop', name: 'Shop', prefix: '/shop', updatedAt: '', updatedBy: '' }
const getItem: Endpoint = {
  integration: 'shop', key: 'get-item', name: 'Get item', method: 'GET', path: '/items/1', pathType: 'exact', contentType: 'json',
  exampleResponses: {}, allowedStatuses: [], updatedAt: '', updatedBy: '',
}

const review = (over: Partial<Recording> = {}): Recording => ({
  id: 'rec-1',
  kind: 'recording',
  target: 'https://api.example.com',
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  createdBy: 'sara',
  expiresAt: new Date(Date.now() + 23 * 3600_000).toISOString(),
  dropped: 0,
  items: [
    {
      id: 'i1', method: 'GET', url: '/shop/items/1', status: 200, bodySize: 22, contentType: 'application/json',
      stub: { name: 'GET /shop/items/1', request: { method: 'GET', urlPath: '/shop/items/1' }, response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { token: 'secret-123' } } },
    },
    {
      id: 'i2', method: 'POST', url: '/shop/orders', status: 201, bodySize: 7,
      stub: { name: 'POST /shop/orders', request: { method: 'POST', urlPath: '/shop/orders' }, response: { status: 201, body: 'created' } },
    },
    {
      id: 'i3', method: 'GET', url: '/hello', status: 200, bodySize: 2, duplicateOf: { id: 'm-9', name: 'Hello' },
      stub: { name: 'GET /hello', request: { method: 'GET', urlPath: '/hello' }, response: { status: 200, body: 'hi' } },
    },
    {
      id: 'i4', method: 'GET', url: '/missing', status: 404, bodySize: 0, unmatched: true,
      stub: { name: 'GET /missing', request: { method: 'GET', urlPath: '/missing' }, response: { status: 404 } },
    },
  ],
  ...over,
})

function catalog() {
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json([shop])),
    http.get(`${BASE}/api/integrations/shop/endpoints`, () => HttpResponse.json([getItem])),
  )
}

describe('nav', () => {
  it('has Recording in Work, hidden when RECORDING_ALLOWED=false', () => {
    expect(APP_NAV.find((i) => i.to === '/recording')?.group).toBe('work')
    expect(navFor(config(false)).map((i) => i.to)).not.toContain('/recording')
    expect(navFor(config(true)).map((i) => i.to)).toContain('/recording')
  })
})

describe('Record tab', () => {
  it('asks for a target, starts with the filters, and shows a refused target under the field', async () => {
    const bodies: unknown[] = []
    server.use(
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [] })),
      http.post(`${BASE}/api/recordings/start`, async ({ request }) => {
        const body = (await request.json()) as { targetUrl: string }
        bodies.push(body)
        if (body.targetUrl.includes('wiremock')) return HttpResponse.json({ error: 'Target URL is WireMock itself, so every request would loop back to WireMock. Enter the real service you want to record.' }, { status: 400 })
        return HttpResponse.json({ status: 'recording', target: body.targetUrl, startedBy: 'sara', startedAt: new Date().toISOString() })
      }),
    )
    const ue = userEvent.setup()
    await renderApp(withConfig(<RecordingPage search={{}} />))
    expect(screen.getByText(/Point your app at WireMock \(http:\/\/wiremock\.test:8080\)/)).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(await screen.findByText('Enter the target URL, like https://api.example.com')).toBeTruthy()
    expect(bodies).toEqual([])

    await ue.type(screen.getByLabelText('Target URL'), 'http://wiremock.test:8080')
    await ue.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(await screen.findByText(/^Target URL is WireMock itself/)).toBeTruthy()

    await ue.clear(screen.getByLabelText('Target URL'))
    await ue.type(screen.getByLabelText('Target URL'), 'https://api.example.com')
    await ue.type(screen.getByLabelText('Paths to record'), '/api/*')
    expect(screen.getByText('^/api/.*$')).toBeTruthy()
    await ue.type(screen.getByLabelText('Request headers to match'), 'Accept, X-Tenant')
    await ue.click(screen.getByRole('switch', { name: 'Turn repeated requests into a scenario' }))
    await ue.click(screen.getByRole('button', { name: 'Start recording' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual({ targetUrl: 'https://api.example.com', urlPathPattern: '/api/*', captureHeaders: ['Accept', 'X-Tenant'], repeatsAsScenarios: false })
    expect(await screen.findByRole('heading', { name: /Recording traffic to https:\/\/api\.example\.com/ })).toBeTruthy()
  })

  it('Paths to record takes wildcards: the regex WireMock gets is shown, a typed query string is left out with a note', async () => {
    server.use(
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [] })),
    )
    const ue = userEvent.setup()
    await renderApp(withConfig(<RecordingPage search={{}} />))
    expect(screen.getByText(/Use \* for anything, e\.g\. \/api\/\* or \/api\/Products\*/)).toBeTruthy()
    await ue.type(screen.getByLabelText('Paths to record'), '/api/Products?limit=3')
    expect(screen.getByText('^/api/Products$')).toBeTruthy()
    expect(screen.getByText(/Matches paths like \/api\/Products \(wildcard\)/)).toBeTruthy()
    expect(screen.getByText('The query string ?limit=3 is left out: WireMock matches the path only.')).toBeTruthy()
  })

  it('a regex is recognised (or picked) and sent as is; one that can never match gets a one-click fix', async () => {
    const bodies: unknown[] = []
    server.use(
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [] })),
      http.post(`${BASE}/api/recordings/start`, async ({ request }) => {
        const body = (await request.json()) as { targetUrl: string }
        bodies.push(body)
        return HttpResponse.json({ status: 'recording', target: body.targetUrl, startedBy: 'sara', startedAt: new Date().toISOString() })
      }),
    )
    const ue = userEvent.setup()
    await renderApp(withConfig(<RecordingPage search={{}} />))
    await ue.type(screen.getByLabelText('Paths to record'), '/api/.*')
    expect(screen.getByText(/\(Java dialect, as WireMock reads it\)/)).toBeTruthy()
    await ue.clear(screen.getByLabelText('Paths to record'))
    // Without regex syntax, auto reads it as a wildcard: pick Regular expression to send it as is.
    await ue.click(screen.getByRole('combobox', { name: 'Read as' }))
    await ue.click(await screen.findByRole('option', { name: 'Regular expression' }))
    expect(screen.getByText(/Regular expression for the path only \(no query string\)/)).toBeTruthy()
    await ue.type(screen.getByLabelText('Paths to record'), 'api/Products?limit=3')
    expect(screen.getByRole('alert').textContent).toContain('This matches the path only, without the query string. To record /api/Products?limit=3 use /api/Products.*')
    await ue.click(screen.getByRole('button', { name: 'Use /api/Products.*' }))
    expect((screen.getByLabelText('Paths to record') as HTMLInputElement).value).toBe('/api/Products.*')
    expect(screen.queryByRole('alert')).toBeNull()
    await ue.type(screen.getByLabelText('Target URL'), 'https://api.testingapis.com')
    await ue.click(screen.getByRole('button', { name: 'Start recording' }))
    await waitFor(() => expect(bodies).toEqual([{ targetUrl: 'https://api.testingapis.com', urlPathPattern: '/api/Products.*', urlPathMode: 'regex', repeatsAsScenarios: true }]))
  })

  it.each([
    [
      { reason: 'filtered', requests: 3, filters: { method: 'POST', urlPathPattern: '^/api/Products$' } },
      '3 requests went through the recording but none matched your filters (method POST, path pattern ^/api/Products$). Remove or fix the filters and record again.',
    ],
    [
      { reason: 'noTraffic', wiremockUrl: 'http://localhost:8080' },
      'No requests reached WireMock while recording. Point your app (or curl) at WireMock — http://localhost:8080 — not at the real service.',
    ],
  ])('an empty stop says why nothing was recorded (%o)', async (empty, message) => {
    server.use(
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'recording', target: 'https://api.example.com', startedBy: 'ann', startedAt: new Date().toISOString() })),
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [] })),
      http.post(`${BASE}/api/recordings/stop`, () => HttpResponse.json({ recording: null, empty })),
    )
    const ue = userEvent.setup()
    await renderApp(withConfig(<RecordingPage search={{}} />))
    await ue.click(await screen.findByRole('button', { name: 'Stop and review' }))
    expect(await screen.findByText('Recording stopped: nothing was recorded')).toBeTruthy()
    expect(await screen.findByText(message)).toBeTruthy()
  })

  it('while recording: Stop opens the review list it produced', async () => {
    server.use(
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'recording', target: 'https://api.example.com', startedBy: 'ann', startedAt: new Date().toISOString() })),
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [] })),
      http.post(`${BASE}/api/recordings/stop`, () => HttpResponse.json({ recording: review() })),
    )
    const ue = userEvent.setup()
    const { router } = await renderApp(withConfig(<RecordingPage search={{}} />))
    expect(await screen.findByText(/Started by ann/)).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Stop and review' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/recording'))
    expect(router.state.location.search).toEqual({ review: 'rec-1' })
    expect(await screen.findByText('Recording stopped: 4 mocks to review')).toBeTruthy()
  })

  it('says recording is off when RECORDING_ALLOWED=false, and asks the server nothing', async () => {
    await renderApp(withConfig(<RecordingPage search={{}} />, false))
    expect(screen.getByText(/Recording is turned off on this environment/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull()
  })
})

describe('review list', () => {
  it('warns about real data, shows each row with its flags, preselects the useful rows and suggests the catalog link', async () => {
    catalog()
    server.use(http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [summaryOf(review())] })),
      http.get(`${BASE}/api/recordings/rec-1`, () => HttpResponse.json(review())), http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })))
    await renderApp(withConfig(<RecordingPage search={{ review: 'rec-1' }} />))
    expect(await screen.findByText('Recorded answers may contain real data')).toBeTruthy()
    expect(screen.getByText(/come straight from https:\/\/api\.example\.com/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Duplicate of Hello' })).toBeTruthy()
    expect(screen.getByText('No mock answered')).toBeTruthy()
    const box = (url: string) => screen.getByRole('checkbox', { name: `Select GET ${url}` }) as HTMLElement
    expect(box('/shop/items/1').getAttribute('data-state')).toBe('checked')
    expect(box('/hello').getAttribute('data-state')).toBe('unchecked')
    expect(box('/missing').getAttribute('data-state')).toBe('unchecked')
    expect(screen.getByRole('button', { name: 'Accept 2 selected' })).toBeTruthy()
    // The recorded body is one click away, secret and all, and only rendered once opened.
    expect(screen.queryByText(/secret-123/)).toBeNull()
    await userEvent.setup().click(screen.getAllByText(/Show recorded answer/)[0])
    expect(screen.getByText(/secret-123/)).toBeTruthy()
    const first = screen.getByText('/shop/items/1').closest('li')!
    await waitFor(() => expect(within(first).getByRole('combobox', { name: 'Endpoint' }).textContent).toContain('Get item'))
    expect(within(first).getByRole('combobox', { name: 'Integration' }).textContent).toContain('Shop')
    const second = screen.getByText('/shop/orders').closest('li')!
    expect(within(second).getByRole('combobox', { name: 'Endpoint' }).textContent).toContain('New endpoint: POST /orders')
  })

  it('accepts the selected rows with their names, links and owner; one mock opens in the editor', async () => {
    catalog()
    const bodies: unknown[] = []
    server.use(
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [summaryOf(review())] })),
      http.get(`${BASE}/api/recordings/rec-1`, () => HttpResponse.json(review())),
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
      http.post(`${BASE}/api/recordings/rec-1/accept`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ created: [{ id: 'i2', mockId: 'm-new' }], failed: [], recording: review({ items: review().items.filter((i) => i.id !== 'i2') }) })
      }),
    )
    const ue = userEvent.setup()
    const { router } = await renderApp(withConfig(<RecordingPage search={{ review: 'rec-1' }} />))
    await screen.findByText('Recorded answers may contain real data')
    await ue.click(screen.getByRole('checkbox', { name: 'Select GET /shop/items/1' }))
    const second = screen.getByText('/shop/orders').closest('li')!
    await ue.type(within(second).getByLabelText('Name'), 'Place order')
    await ue.click(screen.getByRole('radio', { name: 'Baseline (shared)' }))
    await ue.click(screen.getByRole('button', { name: 'Accept 1 selected' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ owner: 'baseline', items: [{ id: 'i2', name: 'Place order', integration: 'shop', newEndpoint: { key: 'post-orders', name: 'POST /orders' } }] })
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/m-new'))
  })

  it('shows rows that failed, and Discard all asks first', async () => {
    catalog()
    let deleted = false
    server.use(
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: deleted ? [] : [summaryOf(review())] })),
      http.get(`${BASE}/api/recordings/rec-1`, () => (deleted ? HttpResponse.json({ error: 'gone' }, { status: 404 }) : HttpResponse.json(review()))),
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
      http.post(`${BASE}/api/recordings/rec-1/accept`, () =>
        HttpResponse.json({ created: [{ id: 'i1', mockId: 'm1' }], failed: [{ id: 'i2', error: 'An endpoint with this key already exists' }], recording: review({ items: review().items.slice(1) }) }),
      ),
      http.delete(`${BASE}/api/recordings/rec-1`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const ue = userEvent.setup()
    const { router } = await renderApp(withConfig(<RecordingPage search={{ review: 'rec-1' }} />))
    await screen.findByText('Recorded answers may contain real data')
    await ue.click(screen.getByRole('button', { name: 'Accept 2 selected' }))
    expect(await screen.findByText('An endpoint with this key already exists')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')

    await ue.click(screen.getByRole('button', { name: 'Discard all' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Nothing was saved yet/)).toBeTruthy()
    await ue.click(within(dialog).getByRole('button', { name: 'Discard all' }))
    await waitFor(() => expect(deleted).toBe(true))
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'review' }))
  })
})

describe('review list: repeated requests and SEED_PRUNE', () => {
  const step = (id: string, required: string, next: string | undefined, body: string) => ({
    id, method: 'GET', url: '/shop/cart', status: 200, bodySize: body.length,
    stub: {
      name: 'GET /shop/cart', request: { method: 'GET', urlPath: '/shop/cart' }, response: { status: 200, body },
      scenarioName: 'scenario-1-cart', requiredScenarioState: required, ...(next ? { newScenarioState: next } : {}),
    },
  })
  const repeated = () => review({ items: [review().items[1], step('c2', 'scenario-1-cart-2', undefined, 'two'), step('c1', 'Started', 'scenario-1-cart-2', 'one')] })

  it('groups a recorded scenario as one item; Keep only the first answer discards the rest and accepts it as a plain mock in one call', async () => {
    catalog()
    let current = repeated()
    const discarded: unknown[] = []
    const accepted: unknown[] = []
    const updated: unknown[] = []
    server.use(
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [summaryOf(current)] })),
      http.get(`${BASE}/api/recordings/rec-1`, () => HttpResponse.json(current)),
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
      http.post(`${BASE}/api/recordings/rec-1/discard`, async ({ request }) => {
        const body = (await request.json()) as { ids: string[] }
        discarded.push(body)
        // As the server does: the lone first answer is saved as a plain row.
        current = {
          ...current,
          items: current.items
            .filter((i) => !body.ids.includes(i.id))
            .map((i) => {
              if (i.id !== 'c1') return i
              const { scenarioName: _n, requiredScenarioState: _r, newScenarioState: _s, ...stub } = i.stub
              return { ...i, stub }
            }),
        }
        return HttpResponse.json({ recording: current })
      }),
      http.post(`${BASE}/api/recordings/rec-1/accept`, async ({ request }) => {
        accepted.push(await request.json())
        return HttpResponse.json({ created: [{ id: 'i2', mockId: 'm1' }, { id: 'c1', mockId: 'm2' }], failed: [], recording: null })
      }),
      // No follow-up save of the created mock.
      http.put(`${BASE}/api/mocks/:id`, async ({ request }) => {
        updated.push(await request.json())
        return HttpResponse.json({})
      }),
    )
    const ue = userEvent.setup()
    await renderApp(withConfig(<RecordingPage search={{ review: 'rec-1' }} />))
    const group = (await screen.findByText('Same request · 2 answers in order')).closest('li')!
    // Replay order (Started first), not list order.
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2)
    await ue.click(within(group).getAllByText('Show recorded answer (3 B)')[0])
    expect(within(group).getByText('one')).toBeTruthy()
    await ue.click(within(group).getByRole('button', { name: 'Keep only the first answer' }))
    await waitFor(() => expect(discarded).toEqual([{ ids: ['c2'] }]))
    expect(await screen.findByText('Plain mock: gives this answer every time')).toBeTruthy()
    expect(screen.queryByText(/answers in order/)).toBeNull()
    await ue.click(screen.getByRole('button', { name: 'Accept 2 selected' }))
    await waitFor(() => expect(accepted).toHaveLength(1))
    const sent = (accepted[0] as { items: { id: string; dropScenario?: boolean }[] }).items
    expect(sent.map((i) => [i.id, i.dropScenario])).toEqual([['i2', undefined], ['c1', true]])
    expect(updated).toEqual([])
  })

  it('turns Baseline off and says why when SEED_PRUNE is on', async () => {
    catalog()
    server.use(
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [summaryOf(review())] })),
      http.get(`${BASE}/api/recordings/rec-1`, () => HttpResponse.json(review())),
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
    )
    await renderApp(
      <ServerConfigProvider config={{ ...config(), seedPrune: true }}>
        <RecordingPage search={{ review: 'rec-1' }} />
      </ServerConfigProvider>,
    )
    const baseline = (await screen.findByRole('radio', { name: 'Baseline (shared)' })) as HTMLButtonElement
    expect(baseline.disabled).toBe(true)
    expect(screen.getByText(/Baseline is off because SEED_PRUNE is on/)).toBeTruthy()
  })
})

describe('review list limits', () => {
  it('a too-large row is flagged and cannot be selected; leftovers in WireMock are called out (WireMock-only wording)', async () => {
    catalog()
    const base = review()
    const big = review({
      leftInWireMock: 2,
      items: [
        { ...base.items[1], id: 'big', url: '/shop/export', bodySize: 3 * 1024 * 1024, tooLarge: true, stub: { ...base.items[1].stub, response: { status: 200 } } },
        base.items[1],
      ],
    })
    server.use(
      http.get(`${BASE}/api/recordings/rec-1`, () => HttpResponse.json(big)),
      http.get(`${BASE}/api/recordings`, () => HttpResponse.json({ recordings: [summaryOf(big)] })),
      http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'idle' })),
    )
    await renderApp(
      <ServerConfigProvider config={{ storeDriver: 'none', wiremockPublicUrl: 'http://wiremock.test:8080', recordingAllowed: true, seedPrune: false }}>
        <RecordingPage search={{ review: 'rec-1' }} />
      </ServerConfigProvider>,
    )
    expect(await screen.findByText('2 recorded stubs are still in WireMock')).toBeTruthy()
    expect(screen.getByText(/show up in the Mocks list as ordinary mocks/)).toBeTruthy()
    expect(screen.getByText(/Too large to review \(3\.0 MB\)/)).toBeTruthy()
    const box = screen.getByRole('checkbox', { name: 'Select POST /shop/export' }) as HTMLButtonElement
    expect(box.disabled).toBe(true)
    expect(box.getAttribute('data-state')).toBe('unchecked')
    expect(screen.getByRole('button', { name: 'Accept 1 selected' })).toBeTruthy()
  })
})

describe('banner', () => {
  it('shows the target and Stop while recording; nothing when idle or not allowed', async () => {
    server.use(http.get(`${BASE}/api/recordings/status`, () => HttpResponse.json({ status: 'recording', target: 'https://api.example.com', startedBy: 'ann', startedAt: new Date().toISOString() })))
    await renderApp(withConfig(<RecordingBanner />))
    const banner = await screen.findByRole('status')
    expect(banner.textContent).toContain('Recording traffic to https://api.example.com')
    expect(within(banner).getByRole('button', { name: 'Stop' })).toBeTruthy()
  })

  it('stays away when recording is not allowed', async () => {
    await renderApp(withConfig(<RecordingBanner />, false))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
