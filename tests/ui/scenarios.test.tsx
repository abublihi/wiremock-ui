import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { Scenario } from '@/server/scenarios/service'
import { ScenariosPage } from '@/routes/_app/scenarios'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { layoutScenario } from '@/ui/components/scenarios/StateMachine'
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
    expect(screen.getByText('// 1 scenario · stateful mocks that answer by state')).toBeTruthy()
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

  it('with no scenarios, explains them and links to a new mock', async () => {
    mockScenarios([[]])
    await renderApp(<ScenariosPage />)
    expect(await screen.findByText('No stateful mocks yet')).toBeTruthy()
    expect(screen.getByText(/the first call returns pending and moves to approved/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create a stateful mock' }).getAttribute('href')).toBe('/mocks/new')
    expect(screen.queryByRole('button', { name: 'Reset all' })).toBeNull()
  })
})

// ── Editor: the Scenario (stateful) section ───────────────────────────────────

const CATALOG = `${BASE}/api/integrations/nic/endpoints`
const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
const endpoint: Endpoint = {
  integration: 'nic',
  key: 'loan',
  name: 'Loan status',
  method: 'GET',
  path: '/loan/status',
  pathType: 'exact',
  lookup: { location: 'query', expression: 'id' },
  contentType: 'json',
  exampleResponses: { '200': '{"status":"pending"}' },
  allowedStatuses: [],
  updatedAt: '',
  updatedBy: '',
}

function NewHarness() {
  const [search, setSearch] = useState<NewMockSearch>({ integration: 'nic', endpoint: 'loan' })
  return <NewMockPage search={search} onSearchChange={setSearch} />
}

describe('mock editor — scenario', () => {
  const open = async () => {
    const calls: Call[] = []
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
      http.get(CATALOG, () => HttpResponse.json([endpoint])),
      http.post(`${CATALOG}/loan/preview`, async ({ request }) => {
        calls.push({ method: 'POST', path: 'preview', body: await request.json() })
        return HttpResponse.json({ name: 'built', request: {}, response: { status: 200 } })
      }),
    )
    mockScenarios([[loan()]])
    await renderApp(<NewHarness />)
    await screen.findByRole('textbox', { name: 'Response body' })
    const ue = userEvent.setup()
    await ue.type(screen.getByLabelText('Value of query parameter id'), '7')
    return { calls, ue }
  }

  it('the switch opens the fields; an existing name and its states can be picked; they go along with the mock', async () => {
    const { calls, ue } = await open()
    expect(screen.queryByRole('textbox', { name: 'Scenario name' })).toBeNull()
    expect(screen.getByText(/the first call returns pending and moves to approved/)).toBeTruthy()
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
    await waitFor(() =>
      expect(calls.at(-1)?.body).toEqual({
        keyValue: '7',
        status: 200,
        body: '{"status":"pending"}',
        scenario: { name: 'loan-approval', requiredState: 'Started', newState: 'approved' },
      }),
    )
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
