import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { Scenario } from '@/server/scenarios/service'
import { ScenarioBuilder } from '@/ui/components/scenarios/ScenarioBuilder'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const CATALOG = `${BASE}/api/integrations/nic/endpoints`
const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
// A text endpoint: its body is a plain textarea (easy to type in here); JSON bodies use the CodeMirror editor.
const endpoint: Endpoint = {
  integration: 'nic',
  key: 'loan',
  name: 'Loan status',
  method: 'GET',
  path: '/loan/status',
  pathType: 'exact',
  lookup: { location: 'query', expression: 'id' },
  contentType: 'text',
  exampleResponses: { '200': 'pending' },
  allowedStatuses: [],
  updatedAt: '',
  updatedBy: '',
}
const existing: Scenario = {
  name: 'loan-approval',
  state: 'Started',
  possibleStates: ['Started', 'approved'],
  settable: true,
  mocks: [{ id: 'm1', requiredState: 'Started', newState: 'approved' }],
}

type Call = { method: string; path: string; body?: unknown }

/**
 * The catalog, the scenario list, and the create/delete endpoints; `failOn` makes the nth create (1-based) fail and
 * `failDelete` the deletes of those mock ids. `scenarioGets` counts the scenario list fetches.
 */
let scenarioGets = 0
function mockApi({ failOn, failDelete = [], scenarios = [] }: { failOn?: number; failDelete?: string[]; scenarios?: Scenario[] } = {}) {
  const calls: Call[] = []
  let creates = 0
  const created = async (path: string, request: Request) => {
    const body = await request.json()
    calls.push({ method: 'POST', path, body })
    creates += 1
    if (creates === failOn) return HttpResponse.json({ error: 'status 418 is not allowed for this endpoint' }, { status: 400 })
    return HttpResponse.json({ id: `m-${creates}`, ...(body as object), metadata: { wiremockUi: { version: 1 } } }, { status: 201 })
  }
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
    http.get(CATALOG, () => HttpResponse.json([endpoint])),
    http.get(`${BASE}/api/scenarios`, () => {
      scenarioGets += 1
      return HttpResponse.json({ scenarios })
    }),
    http.post(`${CATALOG}/loan/mocks`, ({ request }) => created('catalog', request)),
    http.post(`${BASE}/api/mocks`, ({ request }) => created('mocks', request)),
    http.delete(`${BASE}/api/mocks/:id`, ({ request, params }) => {
      calls.push({ method: 'DELETE', path: `${String(params.id)}?version=${new URL(request.url).searchParams.get('version')}` })
      if (failDelete.includes(String(params.id))) return HttpResponse.json({ error: 'WireMock is not reachable' }, { status: 502 })
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const moveSelect = (n: number) => screen.getByRole('combobox', { name: `Step ${n}: then move to` })

async function pickEndpoint(ue: ReturnType<typeof userEvent.setup>) {
  await ue.click(await screen.findByRole('option', { name: /Loan status/ }))
  await ue.type(await screen.findByLabelText('Value of query parameter id'), '7')
}

describe('scenario builder', () => {
  it('explains a scenario; step 1 is Started; each step moves to the next by default and the last one stays', async () => {
    mockApi()
    await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    expect(screen.getByRole('heading', { level: 1, name: 'New scenario' })).toBeTruthy()
    expect(screen.getByText(/A scenario is a set of mocks for the same request that answer differently/)).toBeTruthy()
    expect(screen.getByText(/each step below is saved as one mock/)).toBeTruthy()

    const first = textbox('Step 1 state')
    expect(first.value).toBe('Started')
    expect(first.readOnly).toBe(true)
    expect(moveSelect(1).textContent).toBe('Next step (Step 2)')
    expect(moveSelect(2).textContent).toBe('Stay here (last step)')

    await ue.type(textbox('Step 2 state'), 'approved')
    expect(moveSelect(1).textContent).toBe('Next step (approved)')
    await ue.click(screen.getByRole('button', { name: 'Add step' }))
    expect(moveSelect(2).textContent).toBe('Next step (Step 3)')
    expect(moveSelect(3).textContent).toBe('Stay here (last step)')

    // The live diagram: the steps' states in order, each step the arrow out of its state.
    const states = screen.getByRole('list', { name: 'States of New scenario' })
    const boxes = within(states).getAllByRole('listitem').filter((li) => li.parentElement === states)
    expect(boxes.map((b) => b.querySelector('.font-mono.text-sm')?.textContent)).toEqual(['Started', 'approved', 'Step 3'])
    expect(within(states).queryByRole('button', { name: /as current/ })).toBeNull()

    // "Then move to" can pick any other step, or stay (on the last step the default already stays: no second "stay").
    await ue.click(moveSelect(3))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Stay here (last step)', 'Step 1: Started', 'Step 2: approved'])
    await ue.click(await screen.findByRole('option', { name: 'Step 1: Started' }))
    expect(moveSelect(3).textContent).toBe('Step 1: Started')
    expect(screen.getByRole('heading', { name: /Step 3/, level: 3 }).textContent).toContain('Step 3 → Started')
  })

  it('validates on save: name, request and every step field; nothing is sent', async () => {
    const calls = mockApi()
    await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Create scenario' }))
    expect(screen.getByText('Enter a scenario name.')).toBeTruthy()
    expect(screen.getByText('Pick an endpoint from the catalog, or switch to Method and URL.')).toBeTruthy()
    expect(screen.getByText("Name this step's state.")).toBeTruthy()
    expect(textbox('Step 2 state').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Fix the highlighted fields, then create the scenario.')).toBeTruthy()

    await ue.type(textbox('Step 2 state'), 'Started')
    expect(screen.getByText("Started is step 1's state; pick another name.")).toBeTruthy()
    await ue.clear(screen.getByRole('spinbutton', { name: 'Step 2 response status' }))
    await ue.type(screen.getByRole('spinbutton', { name: 'Step 2 response status' }), '99')
    expect(screen.getByText('Enter a status between 100 and 599.')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('a name WireMock cannot address is refused as you type; an existing name warns and links to it', async () => {
    mockApi({ scenarios: [existing] })
    await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    await ue.type(textbox('Scenario name'), 'loan approval')
    expect(screen.getByText(/Use letters, digits and - _ . only/)).toBeTruthy()
    await ue.clear(textbox('Scenario name'))
    await ue.type(textbox('Scenario name'), 'loan-approval')
    expect(await screen.findByText(/A scenario named loan-approval already exists/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe('/scenarios?scenario=loan-approval')
  })

  it('saves one mock per step through the catalog builder, then opens the scenario with a toast', async () => {
    const calls = mockApi()
    const { router } = await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    await ue.type(textbox('Scenario name'), 'loan-approval')
    await pickEndpoint(ue)
    // Bodies start from the catalog example for their status.
    expect(textbox('Step 1 response body').value).toBe('pending')
    expect(screen.getAllByText('// prefilled from the catalog example for 200')).toHaveLength(2)
    await ue.type(textbox('Step 2 state'), 'approved')
    await ue.clear(textbox('Step 2 response body'))
    await ue.type(textbox('Step 2 response body'), 'approved')
    await ue.type(screen.getByRole('spinbutton', { name: 'Step 2 delay in seconds' }), '2')
    // Custom headers would make a step Advanced-only; the hint says so.
    expect(screen.getAllByText('Custom headers make this step editable in Advanced mode only.')).toHaveLength(2)

    await ue.click(screen.getByRole('button', { name: 'Create scenario' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'))
    expect(router.state.location.search).toEqual({ scenario: 'loan-approval' })
    expect(await screen.findByText('Scenario loan-approval created with 2 steps')).toBeTruthy()
    expect(calls).toEqual([
      {
        method: 'POST',
        path: 'catalog',
        body: {
          keyValue: '7',
          status: 200,
          body: 'pending',
          name: 'loan-approval — Started',
          scenario: { name: 'loan-approval', requiredState: 'Started', newState: 'approved' },
        },
      },
      {
        method: 'POST',
        path: 'catalog',
        body: {
          keyValue: '7',
          status: 200,
          body: 'approved',
          delayMs: 2000,
          name: 'loan-approval — approved',
          scenario: { name: 'loan-approval', requiredState: 'approved' },
        },
      },
    ])
  })

  it('all or nothing: a refused step removes the mocks made before it and says which step failed', async () => {
    const calls = mockApi({ failOn: 3 })
    const { router } = await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    await ue.type(textbox('Scenario name'), 'loan-approval')
    await pickEndpoint(ue)
    await ue.type(textbox('Step 2 state'), 'approved')
    await ue.click(screen.getByRole('button', { name: 'Add step' }))
    await ue.type(textbox('Step 3 state'), 'closed')

    await ue.click(screen.getByRole('button', { name: 'Create scenario' }))
    expect(
      await screen.findByText('Step 3 (closed) was refused: status 418 is not allowed for this endpoint. Nothing was saved; fix it and try again.'),
    ).toBeTruthy()
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([
      { method: 'DELETE', path: 'm-2?version=1' },
      { method: 'DELETE', path: 'm-1?version=1' },
    ])
    expect(router.state.location.pathname).toBe('/')
  })

  it('when taking back a step fails too, the message names the mocks left behind and the scenario list refreshes', async () => {
    mockApi({ failOn: 3, failDelete: ['m-1'] })
    await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    await ue.type(textbox('Scenario name'), 'loan-approval')
    await pickEndpoint(ue)
    await ue.type(textbox('Step 2 state'), 'approved')
    await ue.click(screen.getByRole('button', { name: 'Add step' }))
    await ue.type(textbox('Step 3 state'), 'closed')
    const gets = scenarioGets

    await ue.click(screen.getByRole('button', { name: 'Create scenario' }))
    expect(
      await screen.findByText(
        'Step 3 (closed) was refused: status 418 is not allowed for this endpoint. These mocks made before it could not be removed: loan-approval — Started. Delete them from Mocks before trying again.',
      ),
    ).toBeTruthy()
    await waitFor(() => expect(scenarioGets).toBeGreaterThan(gets))
  })

  it('an uncatalogued request: method and URL, saved as full stubs', async () => {
    const calls = mockApi()
    await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    await ue.type(textbox('Scenario name'), 'order')
    await ue.click(screen.getByRole('radio', { name: 'Method and URL' }))
    await ue.type(textbox('URL'), 'orders/1')
    await ue.type(textbox('Step 2 state'), 'shipped')
    await ue.click(screen.getByRole('button', { name: 'Create scenario' }))
    expect(screen.getByText('Enter a URL path that starts with /, e.g. /orders/42/status.')).toBeTruthy()
    await ue.clear(textbox('URL'))
    await ue.type(textbox('URL'), '/orders/1')
    await ue.click(screen.getByRole('button', { name: 'Create scenario' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls.map((c) => c.body)).toEqual([
      {
        name: 'order — Started',
        request: { method: 'GET', urlPath: '/orders/1' },
        response: { status: 200 },
        scenarioName: 'order',
        requiredScenarioState: 'Started',
        newScenarioState: 'shipped',
      },
      {
        name: 'order — shipped',
        request: { method: 'GET', urlPath: '/orders/1' },
        response: { status: 200 },
        scenarioName: 'order',
        requiredScenarioState: 'shipped',
      },
    ])
  })

  it('steps reorder and remove from the keyboard; focus stays on the control and the move is announced', async () => {
    mockApi()
    await renderApp(<ScenarioBuilder />)
    const ue = userEvent.setup()
    await ue.type(textbox('Step 2 state'), 'paid')
    await ue.click(screen.getByRole('button', { name: 'Add step' }))
    await waitFor(() => expect(document.activeElement).toBe(textbox('Step 3 state')))
    await ue.keyboard('shipped')

    screen.getByRole('button', { name: 'Move step 3 up' }).focus()
    await ue.keyboard('{Enter}')
    expect(textbox('Step 2 state').value).toBe('shipped')
    expect(textbox('Step 3 state').value).toBe('paid')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move step 2 up' }))
    expect(screen.getByText('Step moved to position 2')).toBeTruthy()

    // Into first place: the step answers in Started and the step it displaces takes over its state name.
    await ue.keyboard('{Enter}')
    expect(textbox('Step 1 state').value).toBe('Started')
    expect(textbox('Step 2 state').value).toBe('shipped')
    expect(textbox('Step 3 state').value).toBe('paid')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move step 1 down' }))

    await ue.click(screen.getByRole('button', { name: 'Remove step 3' }))
    expect(screen.queryByRole('textbox', { name: 'Step 3 state' })).toBeNull()
    expect(screen.getByText('Step 3 removed')).toBeTruthy()
  })
})
