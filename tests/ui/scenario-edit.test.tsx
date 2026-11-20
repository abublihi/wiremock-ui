import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { Scenario } from '@/server/scenarios/service'
import type { StubMapping } from '@/server/wiremock/types'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { MockTable } from '@/ui/components/mocks/MockTable'
import { ScenarioBuilder } from '@/ui/components/scenarios/ScenarioBuilder'
import { ScenarioList } from '@/ui/components/scenarios/ScenarioList'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
// A text endpoint: step bodies are plain textareas.
const endpoint: Endpoint = {
  integration: 'nic',
  key: 'loan',
  name: 'Loan status',
  method: 'GET',
  path: '/loan/status',
  pathType: 'exact',
  contentType: 'text',
  exampleResponses: {},
  allowedStatuses: [],
  updatedAt: '',
  updatedBy: '',
}
const REQUEST = { method: 'GET', urlPath: '/nic/loan/status' }
const meta = (version: number) => ({ wiremockUi: { integration: 'nic', endpoint: 'loan', owner: 'sara', version, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'sara', source: 'ui' } })
const pending = {
  id: 'm1',
  name: 'loan — Started',
  request: REQUEST,
  response: { status: 200, body: 'pending' },
  scenarioName: 'loan',
  requiredScenarioState: 'Started',
  newScenarioState: 'approved',
  metadata: meta(3),
} as StubMapping
const approved = {
  id: 'm2',
  name: 'loan — approved',
  request: REQUEST,
  response: { status: 200, body: 'approved' },
  scenarioName: 'loan',
  requiredScenarioState: 'approved',
  metadata: meta(2),
} as StubMapping
const cancel = {
  id: 'k1',
  name: 'Cancel loan',
  request: { method: 'DELETE', urlPath: '/nic/loan' },
  response: { status: 204 },
  scenarioName: 'loan',
  newScenarioState: 'Started',
  metadata: meta(1),
} as StubMapping

type Call = { method: string; path: string; body?: unknown }

/** The scenario's mocks and every write the edit makes; `failPut` refuses the update of that id, `noHistory` every restore. */
function mockApi({ failPut, noHistory = false }: { failPut?: string; noHistory?: boolean } = {}) {
  const calls: Call[] = []
  const stubs = [pending, approved, cancel]
  let created = 0
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
    http.get(`${BASE}/api/integrations/nic/endpoints`, () => HttpResponse.json([endpoint])),
    http.get(`${BASE}/api/scenarios`, () => HttpResponse.json({ scenarios: [] })),
    http.get(`${BASE}/api/mocks`, ({ request }) => {
      calls.push({ method: 'GET', path: `mocks${new URL(request.url).search}` })
      return HttpResponse.json(stubs)
    }),
    http.post(`${BASE}/api/mocks`, async ({ request }) => {
      const body = (await request.json()) as object
      calls.push({ method: 'POST', path: 'mocks', body })
      created += 1
      return HttpResponse.json({ id: `new-${created}`, ...body, metadata: { wiremockUi: { version: 1 } } }, { status: 201 })
    }),
    http.put(`${BASE}/api/mocks/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { stub: object; version: number }
      calls.push({ method: 'PUT', path: String(params.id), body })
      if (params.id === failPut) return HttpResponse.json({ error: 'Someone else saved this mock first' }, { status: 409 })
      return HttpResponse.json({ id: params.id, ...body.stub, metadata: { wiremockUi: { version: body.version + 1 } } })
    }),
    http.post(`${BASE}/api/mocks/:id/restore`, async ({ request, params }) => {
      calls.push({ method: 'RESTORE', path: String(params.id), body: await request.json() })
      if (noHistory) return HttpResponse.json({ error: 'Version not found' }, { status: 404 })
      return HttpResponse.json({ id: params.id, request: REQUEST, response: {}, metadata: { wiremockUi: { version: 9 } } })
    }),
    http.delete(`${BASE}/api/mocks/:id`, ({ request, params }) => {
      calls.push({ method: 'DELETE', path: `${String(params.id)}?version=${new URL(request.url).searchParams.get('version')}` })
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return calls
}

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')

async function open() {
  const app = await renderApp(<ScenarioBuilder editName="loan" />)
  await screen.findByRole('heading', { level: 1, name: 'Edit scenario' })
  return { ue: userEvent.setup(), ...app }
}

describe('editing a scenario', () => {
  it('loads every mock of a long scenario (more than one page of the mocks list): no limit is sent', async () => {
    const steps = Array.from(
      { length: 60 },
      (_, i) =>
        ({
          id: `long-${i}`,
          name: `loan — ${i}`,
          request: REQUEST,
          response: { status: 200, body: `answer ${i}` },
          scenarioName: 'loan',
          requiredScenarioState: i === 0 ? 'Started' : `s${i}`,
          ...(i < 59 ? { newScenarioState: `s${i + 1}` } : {}),
          metadata: meta(1),
        }) as StubMapping,
    )
    const urls: URL[] = []
    server.use(
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
      http.get(`${BASE}/api/integrations/nic/endpoints`, () => HttpResponse.json([endpoint])),
      http.get(`${BASE}/api/scenarios`, () => HttpResponse.json({ scenarios: [] })),
      http.get(`${BASE}/api/mocks`, ({ request }) => {
        const url = new URL(request.url)
        urls.push(url)
        // A paged request would get one page of rows only; the loader must not ask for one.
        return url.searchParams.has('limit') ? HttpResponse.json({ error: 'unexpected limit' }, { status: 400 }) : HttpResponse.json(steps)
      }),
    )
    await open()
    expect(urls.every((u) => !u.searchParams.has('limit'))).toBe(true)
    expect(textbox('Step 1 response body').value).toBe('answer 0')
    expect(textbox('Step 60 response body').value).toBe('answer 59')
    expect(screen.queryByRole('textbox', { name: 'Step 61 response body' })).toBeNull()
  })

  it('loads its mocks as steps, shows the request read-only and lists the mocks kept as is', async () => {
    const calls = mockApi()
    await open()
    expect(calls[0].path).toBe('mocks?scenario=loan')
    expect(textbox('Scenario name').value).toBe('loan')
    expect(textbox('Step 1 state').value).toBe('Started')
    expect(textbox('Step 2 state').value).toBe('approved')
    expect(textbox('Step 1 response body').value).toBe('pending')
    const request = screen.getByRole('heading', { name: 'Request' }).closest('section')!
    expect(within(request).getByText('/nic/loan/status')).toBeTruthy()
    expect(within(request).getByText('NIC → Loan status')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Method and URL' })).toBeNull()
    const kept = screen.getByRole('heading', { name: /Kept as is \(1\)/ }).closest('section')!
    expect(within(kept).getByText('Cancel loan')).toBeTruthy()
    expect(within(kept).getByText(/answers in any state/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save scenario' })).toBeTruthy()
  })

  it('saves the difference: a new step is created, the changed step updated with its version, nothing else touched', async () => {
    const calls = mockApi()
    const { ue, router } = await open()
    const body = textbox('Step 2 response body')
    await ue.clear(body)
    await ue.type(body, 'approved!')
    await ue.click(screen.getByRole('button', { name: 'Add step' }))
    await ue.type(textbox('Step 3 state'), 'paid')
    await ue.type(textbox('Step 3 response body'), 'paid out')
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'))
    expect(router.state.location.search).toEqual({ scenario: 'loan' })
    expect(await screen.findByText('Scenario loan saved: 1 added, 1 changed, 0 removed')).toBeTruthy()
    expect(writes(calls)).toEqual([
      {
        method: 'POST',
        path: 'mocks',
        body: {
          name: 'loan — paid',
          request: REQUEST,
          response: { status: 200, body: 'paid out' },
          scenarioName: 'loan',
          requiredScenarioState: 'paid',
          metadata: { wiremockUi: { integration: 'nic', endpoint: 'loan' } },
        },
      },
      {
        method: 'PUT',
        path: 'm2',
        body: {
          version: 2,
          stub: {
            name: 'loan — approved',
            request: REQUEST,
            response: { status: 200, body: 'approved!' },
            scenarioName: 'loan',
            requiredScenarioState: 'approved',
            newScenarioState: 'paid',
            metadata: { wiremockUi: { integration: 'nic', endpoint: 'loan' } },
          },
        },
      },
    ])
  })

  it('a removed step is deleted with its version', async () => {
    const calls = mockApi()
    const { ue, router } = await open()
    await ue.click(screen.getByRole('button', { name: 'Remove step 2' }))
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'))
    // Step 1 no longer has a step to move to, so it now stays: an update, then the delete.
    expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual(['PUT m1', 'DELETE m2?version=2'])
  })

  it('all or nothing: a refused update undoes the writes before it (restored to their version) and says what failed', async () => {
    const calls = mockApi({ failPut: 'm2' })
    const { ue, router } = await open()
    const name = textbox('Scenario name')
    await ue.clear(name)
    await ue.type(name, 'loan-v2')
    expect(screen.getByText(/The 1 mocks kept as is aren't renamed: they stay in scenario loan/)).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    expect(
      await screen.findByText('Step 2 (approved) was refused: Someone else saved this mock first. Nothing was changed; fix it and try again.'),
    ).toBeTruthy()
    expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual(['PUT m1', 'PUT m2', 'RESTORE m1'])
    expect(writes(calls).at(-1)!.body).toEqual({ version: 3 })
    expect(router.state.location.pathname).toBe('/')
  })

  it('without history (WireMock-only mode) the undo puts the old stub back with an update', async () => {
    const calls = mockApi({ failPut: 'm2', noHistory: true })
    const { ue } = await open()
    await ue.clear(textbox('Scenario name'))
    await ue.type(textbox('Scenario name'), 'loan-v2')
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    await screen.findByText(/Nothing was changed/)
    const undo = writes(calls).at(-1)!
    expect(undo).toEqual({
      method: 'PUT',
      path: 'm1',
      body: {
        version: 4,
        stub: {
          name: 'loan — Started',
          request: REQUEST,
          response: { status: 200, body: 'pending' },
          scenarioName: 'loan',
          requiredScenarioState: 'Started',
          newScenarioState: 'approved',
          metadata: { wiremockUi: { integration: 'nic', endpoint: 'loan' } },
        },
      },
    })
  })

  it('nothing changed: says so and sends nothing', async () => {
    const calls = mockApi()
    const { ue } = await open()
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    expect(await screen.findByText('Nothing to save: no step changed')).toBeTruthy()
    expect(writes(calls)).toEqual([])
  })
})

describe('a scenario card', () => {
  const scenario: Scenario = {
    name: 'loan',
    state: 'Started',
    possibleStates: ['Started', 'approved'],
    settable: true,
    // Out of order on purpose: the confirm lists them in the order the scenario runs.
    mocks: [
      { id: 'k1', name: 'Cancel loan', method: 'DELETE', url: '/nic/loan', newState: 'Started' },
      { id: 'm2', name: 'loan — approved', method: 'GET', url: '/nic/loan/status', requiredState: 'approved' },
      { id: 'm1', name: 'loan — Started', method: 'GET', url: '/nic/loan/status', requiredState: 'Started', newState: 'approved' },
    ],
  }

  it('links to Edit scenario', async () => {
    mockApi()
    await renderApp(<ScenarioList scenarios={[scenario]} />)
    expect(screen.getByRole('link', { name: 'Edit scenario' }).getAttribute('href')).toBe('/scenarios/loan/edit')
  })

  it('Delete scenario confirms with the list of its mocks, then deletes each with its version', async () => {
    const calls = mockApi()
    await renderApp(<ScenarioList scenarios={[scenario]} />)
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Delete scenario' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete scenario loan?' })
    expect(within(dialog).getByText(/This deletes all 3 of its mocks/)).toBeTruthy()
    const list = within(dialog).getByRole('list', { name: 'Mocks to delete' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'GETloan — StartedStarted',
      'GETloan — approvedapproved',
      'DELETECancel loanany state',
    ])
    await ue.click(within(dialog).getByRole('button', { name: 'Delete 3 mocks' }))
    expect(await screen.findByText('Scenario loan deleted (3 mocks)')).toBeTruthy()
    expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE m1?version=3', 'DELETE m2?version=2', 'DELETE k1?version=1'])
    expect(calls.find((c) => c.method === 'GET')!.path).toBe('mocks?scenario=loan')
  })
})

describe('the mocks list', () => {
  const plain = { id: 'p1', name: 'Plain mock', request: { method: 'GET', urlPath: '/plain' }, response: { status: 200 }, metadata: meta(1) } as StubMapping

  it('shows a scenario as one collapsible row with its step mocks inside, and scenario actions', async () => {
    await renderApp(<MockTable mocks={[approved, plain, cancel, pending]} />)
    const ue = userEvent.setup()
    const rows = () => screen.getAllByRole('row').slice(1)
    expect(rows().map((r) => r.textContent?.slice(0, 30))).toEqual([expect.stringContaining('Scenario: loan · 3 mocks'), expect.stringContaining('Plain mock')])
    const toggle = screen.getByRole('button', { name: 'Scenario: loan · 3 mocks' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: 'loan — Started' })).toBeNull()

    await ue.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // The steps in transition order, then the any-state mock.
    expect(screen.getAllByRole('link', { name: /loan —|Cancel loan/ }).map((a) => a.textContent)).toEqual(['loan — Started', 'loan — approved', 'Cancel loan'])
    expect(screen.getByText('Started → approved')).toBeTruthy()

    await ue.click(screen.getByRole('button', { name: 'Actions for scenario loan' }))
    expect((await screen.findByRole('menuitem', { name: 'Edit scenario' })).getAttribute('href')).toBe('/scenarios/loan/edit')
    expect(screen.getByRole('menuitem', { name: 'Open in Scenarios' }).getAttribute('href')).toBe('/scenarios?scenario=loan')
  })
})

describe('the mock editor of a step mock', () => {
  it('links to editing the whole scenario', async () => {
    mockApi()
    server.use(http.get(`${BASE}/api/mocks/m2`, () => HttpResponse.json(approved)))
    await renderApp(<EditMockPage id="m2" />)
    const link = await screen.findByRole('link', { name: 'Edit the whole scenario' })
    expect(link.getAttribute('href')).toBe('/scenarios/loan/edit')
    expect(link.parentElement!.textContent).toContain('Part of scenario loan')
  })
})
