import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildQuickStub, type QuickMockInput } from '@/server/catalog/build'
import type { Scenario } from '@/server/scenarios/service'
import { ScenariosPage } from '@/routes/_app/scenarios.index'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { layoutScenario } from '@/ui/components/scenarios/StateMachine'
import { ServerConfigProvider } from '@/ui/config'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
  vi.useRealTimers()
  visibility = 'visible'
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'

let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
}

const loan = (over: Partial<Scenario> = {}): Scenario => ({
  name: 'loan-approval',
  state: 'Started',
  possibleStates: ['Started', 'approved'],
  settable: true,
  mocks: [
    { id: 'm1', name: 'Loan pending', method: 'GET', url: '/nic/loan/status', requiredState: 'Started', newState: 'approved' },
    { id: 'm2', name: 'Loan approved', method: 'GET', url: '/nic/loan/status', requiredState: 'approved' },
  ],
  ...over,
})

type Call = { method: string; path: string; body?: unknown }
/** Serves `pages` of GET /api/scenarios in order (the last repeats) and records every write. */
function mockScenarios(pages: Scenario[][]) {
  const calls: Call[] = []
  let gets = 0
  server.use(
    http.get(`${BASE}/api/scenarios`, () => HttpResponse.json({ scenarios: pages[Math.min(gets++, pages.length - 1)] })),
    http.put(`${BASE}/api/scenarios/:name/state`, async ({ request, params }) => {
      const body = (await request.json()) as { state: string }
      calls.push({ method: 'PUT', path: String(params.name), body })
      return HttpResponse.json({ ...loan(), state: body.state })
    }),
    http.post(`${BASE}/api/scenarios/reset`, async ({ request }) => {
      calls.push({ method: 'POST', path: 'reset', body: await request.json() })
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return { calls, gets: () => gets }
}

describe('layoutScenario', () => {
  it('sorts mocks into steps between neighbours, loops on a state, and other moves', () => {
    const layout = layoutScenario({
      possibleStates: ['Started', 'paid', 'shipped'],
      mocks: [
        { id: 'a', requiredState: 'Started', newState: 'paid' },
        { id: 'b', requiredState: 'paid', newState: 'shipped' },
        { id: 'c', requiredState: 'shipped', newState: 'Started' },
        { id: 'd', requiredState: 'paid' },
        { id: 'e', requiredState: 'paid', newState: 'paid' },
        { id: 'f', requiredState: 'Started', newState: 'shipped' },
        { id: 'g', newState: 'paid' },
        { id: 'h' },
      ],
    })
    expect([...layout.steps].map(([i, ms]) => [i, ms.map((m) => m.id)])).toEqual([[0, ['a']], [1, ['b']]])
    expect([...layout.loops].map(([s, ms]) => [s, ms.map((m) => m.id)])).toEqual([['paid', ['d', 'e']]])
    expect(layout.jumps.map((j) => [j.from, j.to, j.mock.id])).toEqual([['shipped', 'Started', 'c'], ['Started', 'shipped', 'f'], [null, 'paid', 'g']])
    expect(layout.anyState.map((m) => m.id)).toEqual(['h'])
  })
})

describe('Scenarios page', () => {
  it('shows each scenario with its states in order, the moves as labelled arrows, and the current state', async () => {
    mockScenarios([[loan({ state: 'approved' })]])
    await renderApp(<ScenariosPage />)
    const card = await screen.findByRole('article', { name: 'loan-approval' })
    const states = within(card).getByRole('list', { name: 'States of loan-approval' })
    const boxes = within(states).getAllByRole('listitem').filter((li) => li.parentElement === states)
    expect(boxes.map((b) => b.querySelector('.font-mono.text-sm')?.textContent)).toEqual(['Started', 'approved'])
    const current = card.querySelector('[aria-current="step"]')!
    expect(current.textContent).toContain('approved')
    expect(within(card).getByRole('list', { name: 'Mocks that make this move' }).textContent).toContain('Loan pending')
    expect(within(card).getByRole('list', { name: 'Mocks that make this move' }).textContent).toContain('/nic/loan/status')
    expect(within(card).getByRole('list', { name: 'Mocks that answer in approved and stay there' }).textContent).toContain('Loan approved')
    expect(within(card).getByRole('link', { name: 'Loan pending' }).getAttribute('href')).toBe('/mocks/m1')
    // The current state has no "Set as current"; the others do.
    expect(within(card).queryByRole('button', { name: 'Set approved as current' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Set Started as current' })).toBeTruthy()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '// 1 scenario · stateful mocks that answer by state')).toBeTruthy()
  })

  it('says which request the scenario answers, with Copy as curl and Try', async () => {
    mockScenarios([[loan()]])
    server.use(
      http.get(`${BASE}/api/mocks/m1`, () =>
        HttpResponse.json({ id: 'm1', request: { method: 'GET', urlPath: '/nic/loan/status' }, response: { status: 200 }, scenarioName: 'loan-approval' }),
      ),
    )
    await renderApp(
      <ServerConfigProvider config={{ storeDriver: 'sqlite', wiremockPublicUrl: 'http://wm:8080', recordingAllowed: true, seedPrune: false }}>
        <ScenariosPage />
      </ServerConfigProvider>,
    )
    const card = await screen.findByRole('article', { name: 'loan-approval' })
    expect(within(card).getByText((_, el) => el?.tagName === 'P' && el.textContent === 'AnswersGET/nic/loan/status')).toBeTruthy()
    const ue = userEvent.setup()
    await ue.click(within(card).getByRole('button', { name: 'Copy as curl: GET /nic/loan/status' }))
    expect(await screen.findByText('Copied curl command')).toBeTruthy()
    expect(await navigator.clipboard.readText()).toContain('http://wm:8080/nic/loan/status')
    await ue.click(within(card).getByRole('button', { name: 'Try GET /nic/loan/status' }))
    const panel = await screen.findByRole('dialog', { name: 'Try this request' })
    expect((within(panel).getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe('/nic/loan/status')
  })

  it('Set as current and Reset call the API and say what happened', async () => {
    const { calls } = mockScenarios([[loan()]])
    await renderApp(<ScenariosPage />)
    const ue = userEvent.setup()
    const card = await screen.findByRole('article', { name: 'loan-approval' })
    await ue.click(within(card).getByRole('button', { name: 'Set approved as current' }))
    await waitFor(() => expect(calls).toEqual([{ method: 'PUT', path: 'loan-approval', body: { state: 'approved' } }]))
    expect(await screen.findByText('loan-approval moved to approved')).toBeTruthy()
    await ue.click(within(card).getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(calls.at(-1)).toEqual({ method: 'POST', path: 'reset', body: { name: 'loan-approval' } }))
    expect(await screen.findByText('loan-approval reset to Started')).toBeTruthy()
  })

  it('Reset all asks first, then resets every scenario', async () => {
    const { calls } = mockScenarios([[loan(), loan({ name: 'kyc' })]])
    await renderApp(<ScenariosPage />)
    const ue = userEvent.setup()
    await screen.findByRole('article', { name: 'kyc' })
    await ue.click(screen.getByRole('button', { name: 'Reset all' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Reset every scenario?' })
    expect(calls).toHaveLength(0)
    await ue.click(within(dialog).getByRole('button', { name: 'Reset all' }))
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: 'reset', body: {} }]))
    expect(await screen.findByText('All scenarios reset to Started')).toBeTruthy()
  })

  it('a name WireMock cannot address: Set as current and Reset are disabled', async () => {
    mockScenarios([[loan({ name: 'with space', settable: false })]])
    await renderApp(<ScenariosPage />)
    const card = await screen.findByRole('article', { name: 'with space' })
    expect((within(card).getByRole('button', { name: 'Set approved as current' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(card).getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('polls the live state every 2 s while visible and pauses while hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { gets } = mockScenarios([[loan()], [loan({ state: 'approved' })]])
    await renderApp(<ScenariosPage />)
    const card = await screen.findByRole('article', { name: 'loan-approval' })
    expect(card.querySelector('[aria-current="step"]')!.textContent).toContain('Started')
    await act(() => vi.advanceTimersByTimeAsync(2100))
    await waitFor(() => expect(card.querySelector('[aria-current="step"]')!.textContent).toContain('approved'))
    act(() => setVisibility('hidden'))
    expect(screen.getByText('Paused while hidden')).toBeTruthy()
    const before = gets()
    await act(() => vi.advanceTimersByTimeAsync(6500))
    expect(gets()).toBe(before)
  })

  it('focus highlights the named scenario (the editor links here with ?scenario=)', async () => {
    mockScenarios([[loan(), loan({ name: 'kyc' })]])
    await renderApp(<ScenariosPage focus="kyc" />)
    const kyc = await screen.findByRole('article', { name: 'kyc' })
    expect(kyc.hasAttribute('data-focused')).toBe(true)
    expect(screen.getByRole('article', { name: 'loan-approval' }).hasAttribute('data-focused')).toBe(false)
  })

  it('with no scenarios, explains them and links to the scenario builder', async () => {
    mockScenarios([[]])
    await renderApp(<ScenariosPage />)
    expect(await screen.findByText('No stateful mocks yet')).toBeTruthy()
    expect(screen.getByText(/an order is pending on the first call, shipped on the next, then delivered/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Build a scenario' }).getAttribute('href')).toBe('/scenarios/new')
    expect(screen.getByRole('link', { name: 'New scenario' }).getAttribute('href')).toBe('/scenarios/new')
    expect(screen.queryByRole('button', { name: 'Reset all' })).toBeNull()
  })

  it('the header opens the builder; each card adds a mock to its scenario, answering in its last state', async () => {
    mockScenarios([[loan()]])
    await renderApp(<ScenariosPage />)
    const card = await screen.findByRole('article', { name: 'loan-approval' })
    expect(screen.getByRole('link', { name: 'New scenario' }).getAttribute('href')).toBe('/scenarios/new')
    expect(within(card).getByRole('link', { name: 'Add a mock to this scenario' }).getAttribute('href')).toBe(
      '/mocks/new?scenario=loan-approval&state=step-3&after=approved',
    )
  })
})

// ── Editor: the Scenario (stateful) section ───────────────────────────────────

/** The quick preview through the real builder (what the Simple form sends and gets back). */
function mockPreview(calls: Call[]) {
  server.use(
    http.get(`${BASE}/api/tags`, () => HttpResponse.json([])),
    http.post(`${BASE}/api/mocks/preview`, async ({ request }) => {
      const body = (await request.json()) as QuickMockInput
      calls.push({ method: 'POST', path: 'preview', body })
      return HttpResponse.json(buildQuickStub(body))
    }),
  )
}

/** Fills the URL form with GET /loan/status. */
async function fillUrl(ue: ReturnType<typeof userEvent.setup>, path = '/loan/status') {
  const url = await screen.findByRole('textbox', { name: 'URL' })
  await ue.clear(url)
  await ue.type(url, path)
}

function NewHarness({ initial = {} }: { initial?: NewMockSearch }) {
  const [search, setSearch] = useState<NewMockSearch>(initial)
  return (
    <>
      <NewMockPage search={search} onSearchChange={setSearch} />
      <output aria-label="search">{JSON.stringify(search)}</output>
    </>
  )
}

describe('mock editor — scenario', () => {
  const open = async () => {
    const calls: Call[] = []
    mockPreview(calls)
    mockScenarios([[loan()]])
    await renderApp(<NewHarness />)
    const ue = userEvent.setup()
    await fillUrl(ue)
    return { calls, ue }
  }

  it('the switch opens the fields; an existing name and its states can be picked; they go along with the mock', async () => {
    const { calls, ue } = await open()
    expect(screen.queryByRole('textbox', { name: 'Scenario name' })).toBeNull()
    expect(screen.getByText(/the first call returns pending and moves to shipped/)).toBeTruthy()
    await ue.click(screen.getByRole('switch', { name: 'Answer differently on later calls' }))
    const required = screen.getByRole('textbox', { name: 'Only answers when the scenario is in state' }) as HTMLInputElement
    expect(required.value).toBe('Started')
    await ue.click(await screen.findByRole('button', { name: 'loan-approval' }))
    expect((screen.getByRole('textbox', { name: 'Scenario name' }) as HTMLInputElement).value).toBe('loan-approval')
    expect(screen.getByText('Joins a scenario 2 mocks already use.')).toBeTruthy()
    // The chosen scenario's live state, and a way to its card.
    expect(screen.getAllByRole('status').some((el) => el.textContent === 'Started')).toBe(true)
    expect(screen.getByRole('link', { name: 'Open in Scenarios' }).getAttribute('href')).toBe('/scenarios?scenario=loan-approval')
    const newState = screen.getByRole('textbox', { name: /Then move the scenario to state/ })
    await ue.click(within(newState.closest('[data-slot="field"]') as HTMLElement).getByRole('button', { name: 'approved' }))

    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ request: { method: 'GET', url: '/loan/status' }, scenario: { name: 'loan-approval', requiredState: 'Started', newState: 'approved' } }))
  })

  it('the live state follows WireMock (polled every 2 s while visible)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { ue } = await open()
    mockScenarios([[loan()], [loan({ state: 'approved' })]])
    await ue.click(screen.getByRole('switch', { name: 'Answer differently on later calls' }))
    await ue.type(screen.getByRole('textbox', { name: 'Scenario name' }), 'loan-approval')
    await screen.findByRole('link', { name: 'Open in Scenarios' })
    await act(() => vi.advanceTimersByTimeAsync(2100))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open in Scenarios' }).parentElement!.textContent).toContain('approved'))
  })

  it('a missing name is flagged on preview; a name WireMock cannot address gets a warning', async () => {
    const { calls, ue } = await open()
    await ue.click(screen.getByRole('switch', { name: 'Answer differently on later calls' }))
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    const name = screen.getByRole('textbox', { name: 'Scenario name' })
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Enter a scenario name, or turn this off.')).toBeTruthy()
    expect(calls).toHaveLength(0)
    await ue.type(name, 'loan approval')
    expect(screen.getByText(/can only reset it with Reset all/)).toBeTruthy()
  })
})

describe('mock editor — adding a step to a scenario', () => {
  const oldLast = {
    id: 'm2',
    name: 'Loan approved',
    request: { method: 'GET', urlPath: '/loan/status' },
    response: { status: 200 },
    scenarioName: 'loan-approval',
    requiredScenarioState: 'approved',
    metadata: { wiremockUi: { tags: ['loans'], version: 4 } },
  }
  const first = { ...oldLast, id: 'm1', name: 'Loan pending', requiredScenarioState: 'Started', newScenarioState: 'approved' }

  /** Preview/create, the mock list and updates; `putStatus` makes the update of the old last step fail. */
  function mockEditorApi({ putStatus = 200 }: { putStatus?: number } = {}) {
    const calls: Call[] = []
    mockPreview(calls)
    server.use(
      http.post(`${BASE}/api/mocks`, async ({ request }) => {
        const body = (await request.json()) as { request: unknown; scenarioName: string; requiredScenarioState: string }
        calls.push({ method: 'POST', path: 'create', body })
        return HttpResponse.json({ id: 'm3', ...body }, { status: 201 })
      }),
      http.get(`${BASE}/api/mocks`, () =>
        HttpResponse.json([
          first,
          oldLast,
          // Same state, another request: never moved on.
          { ...oldLast, id: 'm4', name: 'Other request', request: { method: 'POST', urlPath: '/loan/status' } },
          { ...oldLast, id: 'm3', name: 'new', requiredScenarioState: 'step-3', metadata: {} },
        ]),
      ),
      http.put(`${BASE}/api/mocks/:id`, async ({ request, params }) => {
        calls.push({ method: 'PUT', path: String(params.id), body: await request.json() })
        return putStatus === 200 ? HttpResponse.json(oldLast) : HttpResponse.json({ error: 'Someone else saved this mock first' }, { status: putStatus })
      }),
    )
    mockScenarios([[loan()]])
    return calls
  }

  async function openAndFill() {
    const ue = userEvent.setup()
    const app = await renderApp(<NewHarness initial={{ scenario: 'loan-approval', state: 'step-3', after: 'approved' }} />)
    // The same request as the old last step: the move is limited to mocks of that request.
    await fillUrl(ue)
    return { ue, ...app }
  }

  it('opened from a scenario card: a banner explains it, the search keeps the scenario, and the Scenario section answers in the new state', async () => {
    const calls = mockEditorApi()
    const { ue } = await openAndFill()
    expect(JSON.parse(screen.getByRole('status', { name: 'search' }).textContent!)).toEqual({
      scenario: 'loan-approval',
      state: 'step-3',
      after: 'approved',
    })
    expect(screen.getByText('Adding a step to scenario loan-approval')).toBeTruthy()
    expect(screen.getByText(/the current last step \(in approved\) has to move the scenario there/)).toBeTruthy()
    expect((screen.getByRole('switch', { name: 'Answer differently on later calls' }) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Scenario name' }) as HTMLInputElement).value).toBe('loan-approval')
    const required = screen.getByRole('textbox', { name: 'Only answers when the scenario is in state' }) as HTMLInputElement
    expect(required.value).toBe('step-3')
    // The checkbox is on by default and follows the state typed in the form.
    expect(screen.getByRole('checkbox', { name: 'Make the current last step move to step-3' }).getAttribute('aria-checked')).toBe('true')
    await ue.clear(required)
    await ue.type(required, 'closed')
    expect(screen.getByRole('checkbox', { name: 'Make the current last step move to closed' })).toBeTruthy()
    await ue.type(required, ' now')
    expect(screen.getByText(/The mocks still work, but Set as current on the Scenarios page can't move the scenario to it/)).toBeTruthy()
    await ue.type(required, '{Backspace>4/}')
    expect(screen.queryByText(/The mocks still work, but Set as current on the Scenarios page can't move the scenario to it/)).toBeNull()

    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect((calls.filter((c) => c.path === 'preview').at(-1)?.body as { scenario?: unknown })?.scenario).toEqual({ name: 'loan-approval', requiredState: 'closed' }))
  })

  it('after saving, the old last step is updated (with its version) to move the scenario to the new state', async () => {
    const calls = mockEditorApi()
    const { ue, router } = await openAndFill()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/m3'))
    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts).toEqual([
      {
        method: 'PUT',
        path: 'm2',
        body: {
          version: 4,
          stub: {
            name: 'Loan approved',
            request: { method: 'GET', urlPath: '/loan/status' },
            response: { status: 200 },
            scenarioName: 'loan-approval',
            requiredScenarioState: 'approved',
            newScenarioState: 'step-3',
            // Its tags stay with it.
            metadata: { wiremockUi: { tags: ['loans'] } },
          },
        },
      },
    ])
    expect(await screen.findByText('Loan approved now moves the scenario to step-3')).toBeTruthy()
  })

  it('a failed update names the mock to fix, offers to open it, and still opens the new mock', async () => {
    mockEditorApi({ putStatus: 409 })
    const { ue, router } = await openAndFill()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    expect(
      await screen.findByText("Couldn't make Loan approved move the scenario to step-3. Open it and set Then move the scenario to state to step-3."),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open it' })).toBeTruthy()
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/m3'))
  })

  it('unticked: only the new mock is saved', async () => {
    const calls = mockEditorApi()
    const { ue, router } = await openAndFill()
    await ue.click(screen.getByRole('checkbox', { name: 'Make the current last step move to step-3' }))
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/m3'))
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
  })

  it('with no mock in the last state, the banner says so and offers no move', async () => {
    mockEditorApi()
    server.use(http.get(`${BASE}/api/mocks`, () => HttpResponse.json([first])))
    await openAndFill()
    expect(await screen.findByText(/No mock answers in approved and stays there/)).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: /Make the current last step move/ })).toBeNull()
  })

  it('the blank JSON stub starts with the scenario fields too', async () => {
    mockScenarios([[loan()]])
    await renderApp(<NewHarness initial={{ mode: 'json', scenario: 'loan-approval', state: 'step-3', after: 'approved' }} />)
    expect(screen.getByText('Adding a step to scenario loan-approval')).toBeTruthy()
    const json = await screen.findByRole('textbox', { name: /stub JSON/i })
    expect(json.textContent).toContain('"scenarioName": "loan-approval"')
    expect(json.textContent).toContain('"requiredScenarioState": "step-3"')
  })
})

describe('Scenarios page: search and pages', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      loan({
        name: `flow-${String(i + 1).padStart(2, '0')}`,
        mocks: [{ id: `m${i}`, name: i === 30 ? 'Refund issued' : `Step ${i}`, method: 'GET', url: i === 31 ? '/shop/refunds' : `/x/${i}`, requiredState: 'Started' }],
      }),
    )

  it('shows 20 cards a page with the Mocks pager; the page is in the URL (page 1 left out) and back/forward work', async () => {
    mockScenarios([many(45)])
    const { router } = await renderApp(<ScenariosPage />)
    await screen.findByText('Showing 1–20 of 45')
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(20)
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Showing 21–40 of 45')
    expect(router.state.location.search).toMatchObject({ page: 2 })
    await ue.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Showing 41–45 of 45')
    act(() => router.history.back())
    await screen.findByText('Showing 21–40 of 45')
    act(() => router.history.back())
    await screen.findByText('Showing 1–20 of 45')
    expect(router.state.location.search).not.toHaveProperty('page')
    act(() => router.history.forward())
    await screen.findByText('Showing 21–40 of 45')
  })

  it('searches names, states and mock names and paths (case-insensitive), back on page 1, with an empty state', async () => {
    mockScenarios([many(45)])
    const { router } = await renderApp(<ScenariosPage />, { path: '/?page=2' })
    await screen.findByText('Showing 21–40 of 45')
    const ue = userEvent.setup()
    const box = screen.getByRole('searchbox', { name: 'Search scenarios' })
    await ue.type(box, 'REFUND')
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'REFUND' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(2))
    expect(screen.getByText('flow-31')).toBeTruthy()
    expect(screen.getByText('flow-32')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    await ue.clear(box)
    await ue.type(box, 'nothing-like-this')
    expect(await screen.findByText('No scenario matches “nothing-like-this”')).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Clear the search' }))
    await screen.findByText('Showing 1–20 of 45')
  })

  it('?scenario= lands on the page holding it, clearing a search that hides it', async () => {
    mockScenarios([many(45)])
    const { router } = await renderApp(<ScenariosPage />, { path: '/?scenario=flow-27&q=flow-0' })
    await screen.findByText('Showing 21–40 of 45')
    expect(router.state.location.search).toEqual({ scenario: 'flow-27', page: 2 })
    expect(screen.getByText('flow-27')).toBeTruthy()
  })

  it('a page past the end goes to the last page', async () => {
    mockScenarios([many(45)])
    const { router } = await renderApp(<ScenariosPage />, { path: '/?page=9' })
    await screen.findByText('Showing 41–45 of 45')
    expect(router.state.location.search).toEqual({ page: 3 })
  })
})
