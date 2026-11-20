import { describe, expect, it } from 'vitest'
import type { Endpoint } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import {
  type BuilderDraft,
  type LoadedScenario,
  editChanges,
  groupMocks,
  keptOnLostStates,
  loadScenario,
  moveStep,
  newStep,
  rebaseScenario,
  removeStep,
  strandedState,
  targetOf,
  validateDraft,
} from '@/ui/lib/scenario-builder'

const REQUEST = { method: 'GET', urlPath: '/orders/42/status' }
const meta = (version: number, extra: Record<string, unknown> = {}) => ({
  wiremockUi: { integration: 'shop', endpoint: 'status', owner: 'sara', version, updatedAt: '', updatedBy: 'sara', source: 'ui' },
  ...extra,
})
const stub = (id: string, over: Record<string, unknown> = {}): StubMapping =>
  ({ id, request: REQUEST, response: { status: 200 }, scenarioName: 'order', metadata: meta(1), ...over }) as StubMapping

/** A three-step scenario as the builder saves it, plus the kinds of mocks it can't show. */
const pending = stub('m1', {
  name: 'order — Started',
  priority: 5,
  requiredScenarioState: 'Started',
  newScenarioState: 'paid',
  response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { status: 'pending' } },
  metadata: meta(3, { team: 'qa' }),
})
const paid = stub('m2', {
  name: 'Paid answer',
  requiredScenarioState: 'paid',
  newScenarioState: 'shipped',
  response: { status: 200, body: 'paid', fixedDelayMilliseconds: 2000 },
})
const shipped = stub('m3', { name: 'order — shipped', requiredScenarioState: 'shipped', response: { status: 200, body: 'shipped' } })
const anyState = stub('k1', { name: 'Cancel', request: { method: 'DELETE', urlPath: '/orders/42' }, newScenarioState: 'Started' })
const proxied = stub('k2', { name: 'Proxy', requiredScenarioState: 'paid', request: { method: 'GET', urlPath: '/orders/42/live' }, response: { proxyBaseUrl: 'https://real.example' } })
const twin = stub('k3', { name: 'Twin', requiredScenarioState: 'shipped', request: { method: 'POST', urlPath: '/orders/42/status' } })
const other = stub('x1', { scenarioName: 'other', requiredScenarioState: 'Started' })
const all = [shipped, other, proxied, paid, anyState, twin, pending]

const load = () => loadScenario(all, 'order')
const draftOf = (loaded: LoadedScenario, over: Partial<BuilderDraft> = {}): BuilderDraft => ({
  name: loaded.name,
  request: { kind: 'existing', method: 'GET', url: '/orders/42/status' },
  steps: loaded.steps,
  ...over,
})

describe('loading a scenario for editing', () => {
  it('turns its mocks into steps in transition order, with the moves they make', () => {
    const loaded = load()
    expect(loaded.steps.map((s) => [s.id, s.state, s.status, s.body, s.delaySeconds])).toEqual([
      ['m1', 'Started', '200', '{\n  "status": "pending"\n}', ''],
      ['m2', 'paid', '200', 'paid', '2'],
      ['m3', 'shipped', '200', 'shipped', ''],
    ])
    expect(loaded.steps[0].headers).toEqual([{ name: 'Content-Type', value: 'application/json' }])
    expect(loaded.steps.map((s) => s.moveTo)).toEqual(['next', 'next', 'next'])
    expect(loaded.steps.map((_, i) => targetOf(loaded.steps, i))).toEqual(['paid', 'shipped', undefined])
    expect(loaded.steps[1].source).toBe(paid)
    expect(loaded.sameRequest).toBe(true)
    expect(loaded.startedMissing).toBe(false)
  })

  it('keeps as is what it cannot show: any-state mocks, responses beyond status/headers/body/delay, a second mock in a state', () => {
    expect(load().kept.map((k) => [k.stub.id, k.reason])).toEqual([
      ['k1', 'anyState'],
      ['k2', 'response'],
      ['k3', 'sameState'],
    ])
  })

  it('derives stay, a jump back to a step, and a move to a state only kept mocks answer in', () => {
    const loaded = loadScenario(
      [
        stub('a', { requiredScenarioState: 'Started', newScenarioState: 'b' }),
        stub('b', { requiredScenarioState: 'b', newScenarioState: 'Started' }),
        stub('c', { requiredScenarioState: 'c' }),
        stub('d', { requiredScenarioState: 'd', newScenarioState: 'nowhere' }),
      ],
      'order',
    )
    expect(loaded.steps.map((s) => [s.id, s.moveTo])).toEqual([
      ['a', 'next'],
      ['b', 'step:a'],
      ['c', 'stay'],
      ['d', 'state:nowhere'],
    ])
    expect(targetOf(loaded.steps, 3)).toBe('nowhere')
  })

  it('notes steps that match different requests', () => {
    const loaded = loadScenario([pending, stub('p', { requiredScenarioState: 'paid', request: { method: 'POST', urlPath: '/pay' } })], 'order')
    expect(loaded.sameRequest).toBe(false)
  })

  it('says when no step can answer in Started', () => {
    expect(loadScenario([anyState, shipped], 'order').startedMissing).toBe(true)
  })
})

describe('saving an edited scenario', () => {
  it('changes nothing when nothing was edited', () => {
    const loaded = load()
    expect(editChanges(loaded, draftOf(loaded))).toEqual([])
  })

  it('updates only the edited fields of a step, keeping its body kind, priority, metadata and catalog link', () => {
    const loaded = load()
    const steps = loaded.steps.map((s) => (s.id === 'm1' ? { ...s, body: '{"status":"waiting"}' } : s))
    const changes = editChanges(loaded, draftOf(loaded, { steps }))
    expect(changes).toHaveLength(1)
    const [change] = changes
    expect(change.kind).toBe('update')
    if (change.kind !== 'update') return
    expect(change.before).toBe(pending)
    expect(change.stub).toEqual({
      name: 'order — Started',
      priority: 5,
      request: REQUEST,
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { status: 'waiting' } },
      scenarioName: 'order',
      requiredScenarioState: 'Started',
      newScenarioState: 'paid',
      metadata: { team: 'qa', wiremockUi: { integration: 'shop', endpoint: 'status' } },
    })
  })

  it('renaming the scenario updates every step; generated mock names follow, names the user chose stay', () => {
    const loaded = load()
    const changes = editChanges(loaded, draftOf(loaded, { name: 'order-v2' }))
    expect(changes.map((c) => c.kind)).toEqual(['update', 'update', 'update'])
    expect(changes.map((c) => (c.kind === 'update' ? [c.stub.name, c.stub.scenarioName] : null))).toEqual([
      ['order-v2 — Started', 'order-v2'],
      ['Paid answer', 'order-v2'],
      ['order-v2 — shipped', 'order-v2'],
    ])
  })

  it('a new step after the last copies the request and link of the step before it; the old last step moves on to it', () => {
    const loaded = load()
    const steps = [...loaded.steps, newStep('new-1', { state: 'delivered', status: '201', body: '{"status":"delivered"}' })]
    const changes = editChanges(loaded, draftOf(loaded, { steps }))
    expect(changes.map((c) => [c.kind, c.kind === 'delete' ? c.before.id : c.state])).toEqual([
      ['create', 'delivered'],
      ['update', 'shipped'],
    ])
    const create = changes[0]
    if (create.kind !== 'create') throw new Error('create first')
    expect(create.step).toBe(4)
    expect(create.stub).toEqual({
      name: 'order — delivered',
      request: REQUEST,
      response: { status: 201, headers: { 'Content-Type': 'application/json' }, body: '{"status":"delivered"}' },
      scenarioName: 'order',
      requiredScenarioState: 'delivered',
      metadata: { wiremockUi: { integration: 'shop', endpoint: 'status' } },
    })
    const update = changes[1]
    expect(update.kind === 'update' && update.stub.newScenarioState).toBe('delivered')
  })

  it('a removed step is deleted and the step before it now ends the scenario', () => {
    const loaded = load()
    const changes = editChanges(loaded, draftOf(loaded, { steps: removeStep(loaded.steps, 'm3') }))
    expect(changes.map((c) => [c.kind, c.kind === 'delete' ? c.before.id : c.state])).toEqual([
      ['update', 'paid'],
      ['delete', 'm3'],
    ])
    const update = changes[0]
    expect(update.kind === 'update' && 'newScenarioState' in update.stub).toBe(false)
  })

  it('reordering renames the states the moved steps answer in', () => {
    const loaded = load()
    const steps = moveStep(loaded.steps, 'm3', -1) // shipped before paid
    const changes = editChanges(loaded, draftOf(loaded, { steps }))
    const byId = Object.fromEntries(changes.map((c) => [c.kind === 'delete' ? c.before.id : c.kind === 'update' ? c.before.id : 'new', c]))
    const states = (id: string) => {
      const c = byId[id]
      return c?.kind === 'update' ? [c.stub.requiredScenarioState, c.stub.newScenarioState] : undefined
    }
    expect(states('m1')).toEqual(['Started', 'shipped'])
    expect(states('m3')).toEqual(['shipped', 'paid'])
    expect(states('m2')).toEqual(['paid', undefined])
  })

  it('a body cleared drops body and jsonBody; a delay cleared drops the delay', () => {
    const loaded = load()
    const steps = loaded.steps.map((s) => (s.id === 'm2' ? { ...s, body: '', delaySeconds: '' } : s))
    const [change] = editChanges(loaded, draftOf(loaded, { steps }))
    expect(change.kind === 'update' && change.stub.response).toEqual({ status: 200 })
  })
})

describe('grouping the mocks list by scenario', () => {
  it('puts a scenario where its first mock is, its steps in transition order, other mocks as they come', () => {
    const plain = stub('p1', { scenarioName: undefined })
    const rows = groupMocks([shipped, plain, other, pending, paid])
    expect(rows.map((r) => (r.kind === 'mock' ? r.stub.id : `${r.name}:${r.mocks.map((m) => m.id).join(',')}`))).toEqual([
      'order:m1,m2,m3',
      'p1',
      'other:x1',
    ])
  })
})

describe('after a refused save', () => {
  const bumped = (s: StubMapping, version: number, over: Record<string, unknown> = {}) =>
    ({ ...s, ...over, metadata: { ...s.metadata, wiremockUi: { ...s.metadata!.wiremockUi!, version } } }) as StubMapping

  it('rebases each step on the current mock: new versions, the user edits kept, untouched fields follow someone else', () => {
    const loaded = load()
    const steps = loaded.steps.map((s) => (s.id === 'm2' ? { ...s, status: '202' } : s))
    const fresh = [
      bumped(pending, 5), // same content, new version (our own undo)
      bumped(paid, 4, { response: { status: 200, body: 'paid by Bob', fixedDelayMilliseconds: 2000 } }), // Bob changed the body
      // m3 deleted by someone else
    ]
    const out = rebaseScenario(loaded, steps, fresh)
    expect(out.notes).toEqual({ m2: 'changed', m3: 'gone' })
    expect(out.steps.map((s) => s.source?.metadata?.wiremockUi?.version)).toEqual([5, 4, undefined])
    expect(out.steps[1].status).toBe('202') // the user's edit
    expect(out.steps[1].body).toBe('paid by Bob') // untouched: follows the current mock
    expect(out.base.steps.map((s) => s.id)).toEqual(['m1', 'm2'])
    // Saving now updates m2 on its new version and creates m3 again.
    const changes = editChanges(out.base, draftOf(out.base, { steps: out.steps }))
    expect(changes.map((c) => [c.kind, c.kind === 'create' ? c.state : c.kind === 'update' ? c.before.metadata?.wiremockUi?.version : c.before.id])).toEqual([
      ['create', 'shipped'],
      ['update', 4],
    ])
  })

  it('finds a live state no mock answers in any more', () => {
    expect(strandedState('paid', all, 'order')).toBeUndefined()
    expect(strandedState('Started', [], 'order')).toBeUndefined()
    expect(strandedState('gone', all, 'order')).toBe('gone')
  })

  it('names kept mocks that use a state the edit renamed or removed', () => {
    const loaded = load()
    // k2 (proxy) answers in paid, k3 (twin) in shipped; rename paid, keep shipped.
    const steps = loaded.steps.map((s) => (s.id === 'm2' ? { ...s, state: 'settled' } : s))
    const lost = keptOnLostStates(loaded, steps)
    expect(lost.states).toEqual(['paid'])
    expect(lost.mocks.map((m) => m.id)).toEqual(['k2'])
    expect(keptOnLostStates(loaded, loaded.steps).mocks).toEqual([])
  })

  it('checks each step against its own endpoint when asked', () => {
    const loaded = load()
    const strict = { allowedStatuses: [201], contentType: 'json' } as unknown as Endpoint
    const errors = validateDraft(draftOf(loaded), { endpointOf: (_step, i) => (i === 1 ? strict : undefined) })
    expect(Object.keys(errors.steps)).toEqual(['m2'])
    expect(errors.steps.m2.status?.key).toBe('builder.statusNotAllowed')
    expect(errors.steps.m2.body?.key).toBe('builder.bodyJson')
  })
})
