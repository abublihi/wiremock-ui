import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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
const REQUEST = { method: 'GET', urlPath: '/nic/loan/status' }
const meta = (version: number) => ({ wiremockUi: { tags: ['loans'], owner: 'sara', version, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'sara', source: 'ui' } })
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
          metadata: { wiremockUi: { tags: ['loans'] } },
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
            metadata: { wiremockUi: { tags: ['loans'] } },
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
          metadata: { wiremockUi: { tags: ['loans'] } },
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

describe('editing a scenario: retries, undo and the live state', () => {
  const shipped = {
    id: 'm3',
    name: 'loan — shipped',
    request: REQUEST,
    response: { status: 200, body: 'shipped' },
    scenarioName: 'loan',
    requiredScenarioState: 'shipped',
    metadata: meta(1),
  } as StubMapping
  const ver = (s: StubMapping) => s.metadata!.wiremockUi!.version
  const withVersion = (s: StubMapping, version: number, over: Record<string, unknown> = {}) =>
    ({ ...s, ...over, metadata: { ...s.metadata, wiremockUi: { ...s.metadata!.wiremockUi!, version } } }) as StubMapping

  /**
   * A small stateful server: mocks with versions (a stale version is 409), restore (or 404 without history), import,
   * the live scenario state and reset. `beforePut`/`beforeDelete` can change the store or fail a call once.
   */
  function statefulApi(
    initial: StubMapping[],
    opts: {
      live?: string
      noHistory?: boolean
      restoreError?: number
      beforePut?: (id: string, store: Map<string, StubMapping>) => Response | void
      beforeDelete?: (id: string) => Response | void
    } = {},
  ) {
    const store = new Map(initial.map((s) => [s.id, s]))
    const history = new Map(initial.map((s) => [s.id, [s]]))
    const calls: Call[] = []
    let live = opts.live ?? 'Started'
    const keep = (s: StubMapping) => {
      store.set(s.id, s)
      history.set(s.id, [...(history.get(s.id) ?? []), s])
    }
    server.use(
      http.get(`${BASE}/api/scenarios`, () => HttpResponse.json({ scenarios: [{ name: 'loan', state: live, possibleStates: [], settable: true, mocks: [] }] })),
      http.post(`${BASE}/api/scenarios/reset`, async ({ request }) => {
        calls.push({ method: 'RESET', path: 'scenarios', body: await request.json() })
        live = 'Started'
        return new HttpResponse(null, { status: 204 })
      }),
      http.get(`${BASE}/api/mocks`, ({ request }) => {
        const scenario = new URL(request.url).searchParams.get('scenario')
        calls.push({ method: 'GET', path: `mocks?scenario=${scenario}` })
        return HttpResponse.json([...store.values()].filter((s) => s.scenarioName === scenario))
      }),
      http.post(`${BASE}/api/mocks`, async ({ request }) => {
        const body = (await request.json()) as StubMapping
        calls.push({ method: 'POST', path: 'mocks', body })
        const stub = { ...body, id: `new-${store.size + 1}`, metadata: { wiremockUi: { ...meta(1).wiremockUi } } } as StubMapping
        keep(stub)
        return HttpResponse.json(stub, { status: 201 })
      }),
      http.put(`${BASE}/api/mocks/:id`, async ({ request, params }) => {
        const id = String(params.id)
        const body = (await request.json()) as { stub: StubMapping; version: number }
        calls.push({ method: 'PUT', path: id, body })
        const early = opts.beforePut?.(id, store)
        if (early) return early
        const current = store.get(id)!
        if (ver(current) !== body.version) return HttpResponse.json({ error: 'Someone else saved this mock first' }, { status: 409 })
        const next = withVersion({ ...body.stub, id } as StubMapping, body.version + 1)
        keep(next)
        return HttpResponse.json(next)
      }),
      http.delete(`${BASE}/api/mocks/:id`, ({ request, params }) => {
        const id = String(params.id)
        calls.push({ method: 'DELETE', path: `${id}?version=${new URL(request.url).searchParams.get('version')}` })
        const early = opts.beforeDelete?.(id)
        if (early) return early
        store.delete(id)
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(`${BASE}/api/mocks/:id/restore`, async ({ request, params }) => {
        const id = String(params.id)
        const body = (await request.json()) as { version: number }
        calls.push({ method: 'RESTORE', path: id, body })
        if (opts.restoreError) return HttpResponse.json({ error: 'store is down' }, { status: opts.restoreError })
        const target = opts.noHistory ? undefined : history.get(id)?.find((s) => ver(s) === body.version)
        if (!target) return HttpResponse.json({ error: 'Version not found' }, { status: 404 })
        const highest = Math.max(...history.get(id)!.map(ver))
        const next = withVersion(target, highest + 1)
        keep(next)
        return HttpResponse.json(next)
      }),
      http.post(`${BASE}/api/import`, async ({ request }) => {
        const body = (await request.json()) as { mocks: StubMapping[] }
        calls.push({ method: 'IMPORT', path: 'import', body })
        for (const m of body.mocks) keep(withVersion(m, 1))
        return HttpResponse.json({ created: body.mocks.length, updated: 0, unchanged: 0, skipped: [], pruned: 0, ignoredOidcIdentities: 0 })
      }),
    )
    return { calls, store }
  }
  const summary = (calls: Call[]) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)

  it('a refused save re-reads the scenario: the retry uses the new versions, keeps the edit and takes the other change', async () => {
    let bobSaved = false
    const { calls, store } = statefulApi([pending, approved, cancel], {
      // Bob saves m2 (a new body) just before our update reaches it.
      beforePut: (id, s) => {
        if (id === 'm2' && !bobSaved) {
          bobSaved = true
          s.set('m2', withVersion(s.get('m2')!, 3, { response: { status: 200, body: 'approved by Bob' } }))
        }
      },
    })
    const { ue, router } = await open()
    await ue.clear(textbox('Scenario name'))
    await ue.type(textbox('Scenario name'), 'loan-v2')
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    expect(await screen.findByText(/Step 2 \(approved\) was refused: Someone else saved this mock first\. Nothing was changed/)).toBeTruthy()
    expect(screen.getByText(/Steps marked below were changed by someone else meanwhile/)).toBeTruthy()
    expect(screen.getByText(/Someone else changed this mock meanwhile/)).toBeTruthy()
    // Bob's body shows (the user had not edited it); the rename is kept.
    expect(textbox('Step 2 response body').value).toBe('approved by Bob')
    expect(textbox('Scenario name').value).toBe('loan-v2')

    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'))
    expect(summary(calls)).toEqual(['PUT m1', 'PUT m2', 'RESTORE m1', 'PUT m1', 'PUT m2'])
    const retry = calls.filter((c) => c.method === 'PUT').slice(-2) as { body: { version: number; stub: StubMapping } }[]
    expect(retry.map((c) => c.body.version)).toEqual([5, 3]) // m1: 3 → update 4 → restore 5; m2: Bob's 3
    expect(store.get('m2')!.response).toEqual({ status: 200, body: 'approved by Bob' })
    expect(store.get('m2')!.scenarioName).toBe('loan-v2')
  })

  it('without history, an undone delete comes back through import under the same id and owner', async () => {
    const { calls, store } = statefulApi([pending, approved, shipped], {
      noHistory: true,
      beforeDelete: (id) => (id === 'm3' ? HttpResponse.json({ error: 'WireMock is not reachable' }, { status: 502 }) : undefined),
    })
    const { ue } = await open()
    await ue.click(screen.getByRole('button', { name: 'Remove step 3' }))
    await ue.click(screen.getByRole('button', { name: 'Remove step 2' }))
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    expect(await screen.findByText(/Removing loan — shipped was refused: WireMock is not reachable\. Nothing was changed/)).toBeTruthy()
    expect(summary(calls)).toEqual(['PUT m1', 'DELETE m2?version=2', 'DELETE m3?version=1', 'RESTORE m2', 'IMPORT import', 'RESTORE m1', 'PUT m1'])
    const imported = (calls.find((c) => c.method === 'IMPORT')!.body as { mocks: StubMapping[] }).mocks[0]
    expect(imported.id).toBe('m2')
    expect(imported.metadata?.wiremockUi).toEqual({ tags: ['loans'], owner: 'sara' })
    expect(store.get('m2')!.response).toEqual(approved.response)
    expect(store.get('m1')!.newScenarioState).toBe('approved')
  })

  it('an undo that fails for another reason is named with that reason', async () => {
    statefulApi([pending, approved], {
      restoreError: 503,
      beforePut: (id) => (id === 'm2' ? HttpResponse.json({ error: 'Someone else saved this mock first' }, { status: 409 }) : undefined),
    })
    const { ue } = await open()
    await ue.clear(textbox('Scenario name'))
    await ue.type(textbox('Scenario name'), 'loan-v2')
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    expect(await screen.findByText(/could not be put back as they were: loan — Started \(store is down\)/)).toBeTruthy()
  })

  it('a live state the edit renamed is reset to Started, and the toast says so', async () => {
    const { calls } = statefulApi([pending, approved], { live: 'approved' })
    const { ue, router } = await open()
    const state = textbox('Step 2 state')
    await ue.clear(state)
    await ue.type(state, 'done')
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'))
    expect(await screen.findByText('Scenario loan saved: 0 added, 2 changed, 0 removed; state reset to Started because approved no longer exists')).toBeTruthy()
    expect(calls.find((c) => c.method === 'RESET')!.body).toEqual({ name: 'loan' })
  })

  it('a live state that still exists is left alone', async () => {
    const { calls } = statefulApi([pending, approved], { live: 'approved' })
    const { ue, router } = await open()
    await ue.clear(textbox('Step 2 response body'))
    await ue.type(textbox('Step 2 response body'), 'yes')
    await ue.click(screen.getByRole('button', { name: 'Save scenario' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/scenarios'))
    expect(calls.some((c) => c.method === 'RESET')).toBe(false)
  })

  it('warns when the edit renames a state a kept mock answers in', async () => {
    const proxy = { ...approved, id: 'k2', name: 'Live proxy', response: { proxyBaseUrl: 'https://real.example' } } as StubMapping
    statefulApi([pending, approved, proxy])
    const { ue } = await open()
    expect(screen.queryByText(/Mocks kept as is still use/)).toBeNull()
    await ue.clear(textbox('Step 2 state'))
    await ue.type(textbox('Step 2 state'), 'done')
    expect(screen.getByText('Mocks kept as is still use approved, which no step answers in after this edit: Live proxy. Update them in the mock editor, or they stop being reached.')).toBeTruthy()
  })

  it('Delete scenario leaves mocks that joined after the list was shown, and says so', async () => {
    const late = { ...approved, id: 'late', name: 'Late step', requiredScenarioState: 'late' } as StubMapping
    const { calls } = statefulApi([pending, approved, late])
    const scenario: Scenario = {
      name: 'loan',
      state: 'Started',
      possibleStates: ['Started', 'approved'],
      settable: true,
      mocks: [
        { id: 'm1', name: 'loan — Started', requiredState: 'Started', newState: 'approved' },
        { id: 'm2', name: 'loan — approved', requiredState: 'approved' },
      ],
    }
    await renderApp(<ScenarioList scenarios={[scenario]} />)
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Delete scenario' }))
    await ue.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete 2 mocks' }))
    expect(await screen.findByText('Not deleted: Late step joined loan after the list was shown. Delete them from Mocks if you meant to.')).toBeTruthy()
    expect(summary(calls)).toEqual(['DELETE m1?version=3', 'DELETE m2?version=2'])
  })

  it('the caption counts mocks', async () => {
    statefulApi([pending, approved, cancel])
    await open()
    expect(screen.getByText('// loan · 3 mocks')).toBeTruthy()
  })
})
