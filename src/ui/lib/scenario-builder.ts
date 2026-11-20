import type { SimpleMockInput } from '@/server/catalog/build'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { Scenario, ScenarioMock } from '@/server/scenarios/service'
import type { StubMapping } from '@/server/wiremock/types'
import type { MessageKey } from '@/ui/i18n'
import { type HeaderRow, STARTED, fromEditable, headerMap, isScenarioNameSettable, linkOf, toEditable } from './editor-sync'

/**
 * The scenario builder's model: one request, an ordered list of steps (each the answer in one state and the
 * state it moves to), turned into one mock per step. Pure, so the page, the tests and the container test share it.
 */

/**
 * Where a step moves the scenario after answering: the next step, nowhere, a step picked by id (survives renames), or —
 * for a scenario loaded for editing — a state no step answers in (only mocks kept as is do).
 */
export type MoveTo = 'next' | 'stay' | `step:${string}` | `state:${string}`

export type BuilderStep = {
  id: string
  /** Ignored for the first step, which is always `Started`. */
  state: string
  /** Text, as typed (validated on save). */
  status: string
  headers: HeaderRow[]
  body: string
  /** Whole seconds as typed (1–120, like Simple mode's "slow"); '' for no delay. */
  delaySeconds: string
  moveTo: MoveTo
  /** The body is the catalog's example for the status and follows it until the user types. */
  bodyFromExample: boolean
  /** Editing: the mock this step was loaded from (absent for a step added in this edit). */
  source?: StubMapping
}

export type CatalogRequest = { kind: 'catalog'; integration: Integration; endpoint: Endpoint; isDefault: boolean; keyValue: string }
export type FreeRequest = { kind: 'free'; method: string; url: string }
/** Editing: the request stays as the loaded mocks have it; `endpoint` (catalog mocks) for the status and body checks. */
export type ExistingRequest = { kind: 'existing'; method?: string; url?: string; endpoint?: Endpoint }
export type BuilderDraft = { name: string; request: CatalogRequest | FreeRequest | ExistingRequest | null; steps: BuilderStep[] }

export type Message = { key: MessageKey; vars?: Record<string, string | number> }
export type StepField = 'state' | 'status' | 'headers' | 'body' | 'delay'
export type BuilderErrors = { name?: Message; request?: Message; steps: Record<string, Partial<Record<StepField, Message>>> }

/** The delay range Simple mode can show (its "slow" switch), so builder mocks reopen in Simple mode. */
export const MIN_DELAY_SECONDS = 1
export const MAX_DELAY_SECONDS = 120

export function newStep(id: string, over: Partial<BuilderStep> = {}): BuilderStep {
  return { id, state: '', status: '200', headers: [], body: '', delaySeconds: '', moveTo: 'next', bodyFromExample: false, ...over }
}

/** The state a step answers in (the first step's is always `Started`). */
export const stepState = (steps: BuilderStep[], i: number) => (i === 0 ? STARTED : steps[i].state.trim())

/** The state step `i` moves the scenario to, or undefined when it stays where it is. */
export function targetOf(steps: BuilderStep[], i: number): string | undefined {
  const move = steps[i].moveTo
  let to: number
  if (move === 'stay') return undefined
  if (move.startsWith('state:')) {
    const state = move.slice('state:'.length)
    return state === '' || state === stepState(steps, i) ? undefined : state
  }
  if (move === 'next') to = i + 1
  else {
    to = steps.findIndex((s) => `step:${s.id}` === move)
    if (to === -1) to = i + 1 // the step it pointed at is gone: back to the default
  }
  if (to >= steps.length) return undefined
  const target = stepState(steps, to)
  return target === '' || target === stepState(steps, i) ? undefined : target
}

/** Drops a step; moves that pointed at it go back to the default. */
export function removeStep(steps: BuilderStep[], id: string): BuilderStep[] {
  return steps.filter((s) => s.id !== id).map((s) => (s.moveTo === `step:${id}` ? { ...s, moveTo: 'next' } : s))
}

/**
 * Swaps a step with its neighbour (`by` -1 up, +1 down); the same array when it can't move. The first step always
 * answers in Started, so a step moving into first place hands its state name to the step it displaces.
 */
export function moveStep(steps: BuilderStep[], id: string, by: -1 | 1): BuilderStep[] {
  const i = steps.findIndex((s) => s.id === id)
  const j = i + by
  if (i === -1 || j < 0 || j >= steps.length) return steps
  const next = [...steps]
  ;[next[i], next[j]] = [next[j], next[i]]
  if (i === 0 || j === 0) {
    next[1] = { ...next[1], state: next[0].state }
    next[0] = { ...next[0], state: '' }
  }
  return next
}

const isInt = (text: string) => /^-?\d+$/.test(text.trim())

/** `keepName`: editing a scenario whose name WireMock can't address — keeping it is allowed (its mocks work as before). */
export function validateDraft(draft: BuilderDraft, opts: { keepName?: string } = {}): BuilderErrors {
  const errors: BuilderErrors = { steps: {} }
  const name = draft.name.trim()
  if (name === '') errors.name = { key: 'builder.nameRequired' }
  else if (!isScenarioNameSettable(name) && name !== opts.keepName) errors.name = { key: 'builder.nameUnsettable' }

  const request = draft.request
  if (!request) errors.request = { key: 'builder.requestRequired' }
  else if (request.kind === 'catalog') {
    if (!request.isDefault && request.endpoint.lookup && request.keyValue.trim() === '') errors.request = { key: 'builder.keyRequired' }
  } else if (request.kind === 'free' && !request.url.trim().startsWith('/')) errors.request = { key: 'builder.urlInvalid' }
  const endpoint = request?.kind === 'catalog' || request?.kind === 'existing' ? request.endpoint : undefined

  const seen = new Set<string>()
  draft.steps.forEach((step, i) => {
    const e: Partial<Record<StepField, Message>> = {}
    const state = stepState(draft.steps, i)
    if (i > 0) {
      if (state === '') e.state = { key: 'builder.stateRequired' }
      else if (state === STARTED) e.state = { key: 'builder.stateStarted' }
      else if (seen.has(state)) e.state = { key: 'builder.stateDuplicate', vars: { state } }
    }
    seen.add(state)

    const status = Number(step.status)
    if (!isInt(step.status) || status < 100 || status > 599) e.status = { key: 'builder.statusRange' }
    else if (endpoint && endpoint.allowedStatuses.length > 0 && !endpoint.allowedStatuses.includes(status))
      e.status = { key: 'builder.statusNotAllowed', vars: { allowed: endpoint.allowedStatuses.join(', ') } }

    if (step.headers.some((r) => r.name.trim() === '' && r.value !== '')) e.headers = { key: 'editor.headers.unnamed' }

    if (endpoint?.contentType === 'json' && step.body.trim() !== '') {
      try {
        JSON.parse(step.body)
      } catch {
        e.body = { key: 'builder.bodyJson' }
      }
    }

    const seconds = step.delaySeconds.trim()
    if (seconds !== '' && (!isInt(seconds) || Number(seconds) < MIN_DELAY_SECONDS || Number(seconds) > MAX_DELAY_SECONDS))
      e.delay = { key: 'builder.delayRange' }

    if (Object.keys(e).length > 0) errors.steps[step.id] = e
  })
  return errors
}

export const hasErrors = (errors: BuilderErrors) => Boolean(errors.name || errors.request || Object.keys(errors.steps).length > 0)

/** The arguments of the catalog create endpoint (same shape as the editor's). */
export type CatalogCreate = { integration: string; endpoint: string; input: SimpleMockInput }
/** One mock to create, in step order; `step` is 1-based. */
export type Create = { step: number; state: string } & ({ kind: 'catalog'; args: CatalogCreate } | { kind: 'free'; stub: Omit<StubMapping, 'id'> })

const looksLikeJson = (text: string) => {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null
  } catch {
    return false
  }
}

/** One create per step: through the catalog builder for a catalog request, a full stub otherwise. Assumes a valid draft. */
export function toCreates(draft: BuilderDraft): Create[] {
  const name = draft.name.trim()
  const request = draft.request!
  if (request.kind === 'existing') throw new Error('toCreates: an existing scenario is saved with editChanges')
  return draft.steps.map((step, i) => {
    const state = stepState(draft.steps, i)
    const newState = targetOf(draft.steps, i)
    const status = Number(step.status)
    const headers = headerMap(step.headers)
    const delay = step.delaySeconds.trim() === '' ? undefined : Number(step.delaySeconds) * 1000
    const mockName = `${name} — ${state}`
    const scenario = { name, requiredState: state, ...(newState ? { newState } : {}) }

    if (request.kind === 'catalog') {
      const input: SimpleMockInput = request.isDefault ? { isDefault: true } : { keyValue: request.keyValue.trim() }
      input.status = status
      if (step.body !== '') input.body = step.body
      if (headers) input.headers = headers
      if (delay !== undefined) input.delayMs = delay
      input.name = mockName
      input.scenario = scenario
      return { step: i + 1, state, kind: 'catalog', args: { integration: request.integration.key, endpoint: request.endpoint.key, input } }
    }

    const url = request.url.trim()
    const response: Record<string, unknown> = { status }
    const hasType = Object.keys(headers ?? {}).some((h) => h.toLowerCase() === 'content-type')
    const allHeaders = { ...(!hasType && looksLikeJson(step.body) ? { 'Content-Type': 'application/json' } : {}), ...headers }
    if (Object.keys(allHeaders).length > 0) response.headers = allHeaders
    if (step.body !== '') response.body = step.body
    if (delay !== undefined) response.fixedDelayMilliseconds = delay
    return {
      step: i + 1,
      state,
      kind: 'free',
      stub: {
        name: mockName,
        request: { method: request.method, ...(url.includes('?') ? { url } : { urlPath: url }) },
        response,
        scenarioName: name,
        requiredScenarioState: state,
        ...(newState ? { newScenarioState: newState } : {}),
      },
    }
  })
}

/** The URL a request answers on, as the diagram shows it. */
function requestLabel(request: BuilderDraft['request']): { method?: string; url?: string } {
  if (!request) return {}
  if (request.kind === 'existing') return { method: request.method, url: request.url }
  if (request.kind === 'free') return { method: request.method, url: request.url.trim() || undefined }
  const root = request.integration.prefix === '/' ? '' : request.integration.prefix
  return { method: request.endpoint.method, url: root + request.endpoint.path }
}

/**
 * The draft as a scenario for the StateMachine diagram: its steps' states in step order (a step without a name yet
 * shows as `label(n)`), each step a mock making its move.
 */
export function previewScenario(draft: BuilderDraft, label: (n: number) => string = (n) => `Step ${n}`): Scenario {
  const named = draft.steps.map((s, i) => ({ ...s, state: stepState(draft.steps, i) || label(i + 1) }))
  const states = [...new Set(named.map((s) => s.state))]
  const { method, url } = requestLabel(draft.request)
  const mocks: ScenarioMock[] = named.map((step, i) => {
    const newState = targetOf(named, i)
    return {
      id: step.id,
      name: label(i + 1),
      ...(method ? { method } : {}),
      ...(url ? { url } : {}),
      requiredState: i === 0 ? STARTED : step.state,
      ...(newState ? { newState } : {}),
    }
  })
  return { name: draft.name.trim(), state: '', possibleStates: states, settable: true, mocks }
}

// ── Adding a step to an existing scenario ─────────────────────────────────────

/** The state a step added after a scenario's last one answers in: `step-<n+1>`, skipping names the scenario uses. */
export function nextStateName(possibleStates: string[]): string {
  let n = possibleStates.length + 1
  while (possibleStates.includes(`step-${n}`)) n++
  return `step-${n}`
}

/** A value as JSON with object keys sorted, so two requests compare equal whatever order their fields were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Whether two mocks match the same calls: the same method, URL field (url, urlPath, urlPattern, urlPathTemplate…) and
 * query, header and body matchers. Field order does not matter; anything else does.
 */
export const sameRequest = (a: Pick<StubMapping, 'request'>, b: Pick<StubMapping, 'request'>) => canonical(a.request ?? {}) === canonical(b.request ?? {})

/**
 * Mocks of a scenario that answer in `from` and leave the scenario there (`exceptId` aside), whatever their request:
 * the candidates for a last step before the new step's request is known.
 */
export function lastStateMocks(stubs: StubMapping[], scenario: string, from: string, exceptId?: string): StubMapping[] {
  return stubs.filter(
    (s) =>
      s.id !== exceptId &&
      s.scenarioName === scenario &&
      s.requiredScenarioState === from &&
      (s.newScenarioState === undefined || s.newScenarioState === '' || s.newScenarioState === from),
  )
}

/**
 * The last step a new step follows: the mocks that answer in `from`, stay there, and match the same request as the new
 * step. Mocks for other requests in that state are left alone — moving them on would send their callers to a state
 * where nothing answers them.
 */
export function lastStepMocks(stubs: StubMapping[], scenario: string, from: string, added: Pick<StubMapping, 'id' | 'request'>): StubMapping[] {
  return lastStateMocks(stubs, scenario, from, added.id).filter((s) => sameRequest(s, added))
}

/** The stub to save over a last-step mock so it moves the scenario on to `to` (the editor's Advanced save shape). */
export function movedOn(stub: StubMapping, to: string): Omit<StubMapping, 'id'> {
  return fromEditable({ ...toEditable(stub), newScenarioState: to }, linkOf(stub))
}

// ── Editing a scenario as one unit ────────────────────────────────────────────

/** Why a mock of the scenario is left out of the builder and saved untouched. */
export type KeptReason = 'anyState' | 'response' | 'sameState'
export type KeptMock = { stub: StubMapping; reason: KeptReason }
export type LoadedScenario = {
  name: string
  /** One step per state, in transition order; each carries the mock it was loaded from. */
  steps: BuilderStep[]
  kept: KeptMock[]
  /** Every step matches the same request (else each step shows its own, read-only). */
  sameRequest: boolean
  /** No mock the builder can show answers in Started: the scenario can't be edited as steps. */
  startedMissing: boolean
}

const STUB_FIELDS = new Set(['id', 'uuid', 'name', 'priority', 'persistent', 'request', 'response', 'metadata', 'scenarioName', 'requiredScenarioState', 'newScenarioState', 'insertionIndex'])
const RESPONSE_FIELDS = new Set(['status', 'headers', 'body', 'jsonBody', 'fixedDelayMilliseconds'])
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Whether a step can show this mock's answer exactly: status, text headers, one inline body and a whole-second delay. */
function fitsStep(stub: StubMapping): boolean {
  if (Object.keys(stub).some((k) => !STUB_FIELDS.has(k))) return false
  const response = stub.response as Record<string, unknown>
  if (!isPlainObject(response) || Object.keys(response).some((k) => !RESPONSE_FIELDS.has(k))) return false
  if (response.status !== undefined && !(Number.isInteger(response.status) && (response.status as number) >= 100 && (response.status as number) <= 599)) return false
  if (response.headers !== undefined && !(isPlainObject(response.headers) && Object.values(response.headers).every((v) => typeof v === 'string'))) return false
  if (response.body !== undefined && typeof response.body !== 'string') return false
  if (response.body !== undefined && response.jsonBody !== undefined) return false
  const delay = response.fixedDelayMilliseconds
  if (delay !== undefined && !(Number.isInteger(delay) && (delay as number) % 1000 === 0 && (delay as number) >= MIN_DELAY_SECONDS * 1000 && (delay as number) <= MAX_DELAY_SECONDS * 1000)) return false
  return true
}

/** A step as the builder shows a mock (its `moveTo` is set once every step is known). */
export function stepFromStub(stub: StubMapping): BuilderStep {
  const response = stub.response as Record<string, unknown>
  const headers = isPlainObject(response.headers) ? Object.entries(response.headers).map(([name, value]) => ({ name, value: String(value) })) : []
  const body = typeof response.body === 'string' ? response.body : response.jsonBody !== undefined ? JSON.stringify(response.jsonBody, null, 2) : ''
  const delay = typeof response.fixedDelayMilliseconds === 'number' ? String(response.fixedDelayMilliseconds / 1000) : ''
  return {
    ...newStep(stub.id),
    state: typeof stub.requiredScenarioState === 'string' ? stub.requiredScenarioState : '',
    status: String(typeof response.status === 'number' ? response.status : 200),
    headers,
    body,
    delaySeconds: delay,
    source: stub,
  }
}

const required = (s: StubMapping) => (typeof s.requiredScenarioState === 'string' && s.requiredScenarioState !== '' ? s.requiredScenarioState : undefined)
const leadsTo = (s: StubMapping) => (typeof s.newScenarioState === 'string' && s.newScenarioState !== '' ? s.newScenarioState : undefined)
const byId = (a: StubMapping, b: StubMapping) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** States in transition order: Started, then breadth-first along the mocks' moves, then the states never reached (A–Z). */
function stateOrder(stubs: StubMapping[]): string[] {
  const order = [STARTED]
  for (let i = 0; i < order.length; i++) {
    const next = stubs.filter((s) => required(s) === order[i]).map(leadsTo).filter((s): s is string => Boolean(s)).sort()
    for (const state of next) if (!order.includes(state)) order.push(state)
  }
  const rest = [...new Set(stubs.map(required).filter((s): s is string => Boolean(s)))].filter((s) => !order.includes(s)).sort()
  return [...order, ...rest]
}

/**
 * A scenario's mocks as builder steps: one step per state (the mock matching the Started step's request first), in
 * transition order. Mocks the builder can't show — "any state" mocks, answers beyond status/headers/body/delay, a
 * second mock in a state — are kept as is.
 */
export function loadScenario(stubs: StubMapping[], name: string): LoadedScenario {
  const mine = stubs.filter((s) => s.scenarioName === name).sort(byId)
  const kept: KeptMock[] = []
  const candidates: StubMapping[] = []
  for (const stub of mine) {
    if (!required(stub)) kept.push({ stub, reason: 'anyState' })
    else if (!fitsStep(stub)) kept.push({ stub, reason: 'response' })
    else candidates.push(stub)
  }
  const first = candidates.find((s) => required(s) === STARTED)
  const chosen: StubMapping[] = []
  for (const stub of [...candidates].sort((a, b) => {
    // In a state with several mocks, the one matching the first step's request becomes the step.
    const same = (s: StubMapping) => (first && sameRequest(s, first) ? 0 : 1)
    return same(a) - same(b) || byId(a, b)
  })) {
    if (chosen.some((c) => required(c) === required(stub))) kept.push({ stub, reason: 'sameState' })
    else chosen.push(stub)
  }
  const order = stateOrder(chosen)
  chosen.sort((a, b) => order.indexOf(required(a)!) - order.indexOf(required(b)!))
  const steps = chosen.map(stepFromStub)
  steps.forEach((step, i) => {
    const source = step.source!
    const to = leadsTo(source)
    const own = required(source)
    if (!to || to === own) step.moveTo = i === steps.length - 1 ? 'next' : 'stay'
    else if (i + 1 < steps.length && required(steps[i + 1].source!) === to) step.moveTo = 'next'
    else {
      const target = steps.find((s) => required(s.source!) === to)
      step.moveTo = target ? `step:${target.id}` : `state:${to}`
    }
  })
  kept.sort((a, b) => byId(a.stub, b.stub))
  return {
    name,
    steps,
    kept,
    sameRequest: steps.every((s) => sameRequest(s.source!, steps[0].source!)),
    startedMissing: !first,
  }
}

/** One write of an edited scenario; `step` is 1-based. Creates come first, then updates, then deletes. */
export type EditChange =
  | { kind: 'create'; step: number; state: string; stub: Omit<StubMapping, 'id'> }
  | { kind: 'update'; step: number; state: string; before: StubMapping; stub: Omit<StubMapping, 'id'> }
  | { kind: 'delete'; before: StubMapping }

const saved = (stub: StubMapping) => fromEditable(toEditable(stub), linkOf(stub))

/** The steps' answer as a new response (a step added while editing). */
function freshResponse(step: BuilderStep): Record<string, unknown> {
  const headers = headerMap(step.headers)
  const hasType = Object.keys(headers ?? {}).some((h) => h.toLowerCase() === 'content-type')
  const allHeaders = { ...(!hasType && looksLikeJson(step.body) ? { 'Content-Type': 'application/json' } : {}), ...headers }
  return {
    status: Number(step.status),
    ...(Object.keys(allHeaders).length > 0 ? { headers: allHeaders } : {}),
    ...(step.body !== '' ? { body: step.body } : {}),
    ...(step.delaySeconds.trim() !== '' ? { fixedDelayMilliseconds: Number(step.delaySeconds) * 1000 } : {}),
  }
}

/** The loaded mock with only what the step changed: everything the builder doesn't show stays as it was. */
function editedResponse(source: StubMapping, step: BuilderStep): Record<string, unknown> {
  const was = stepFromStub(source)
  const response = { ...(source.response as Record<string, unknown>) }
  if (step.status.trim() !== was.status) response.status = Number(step.status)
  if (canonical(step.headers) !== canonical(was.headers)) {
    const headers = headerMap(step.headers)
    if (headers) response.headers = headers
    else delete response.headers
  }
  if (step.body !== was.body) {
    const asJson = 'jsonBody' in response ? parseJson(step.body) : undefined
    delete response.body
    delete response.jsonBody
    if (asJson !== undefined) response.jsonBody = asJson
    else if (step.body !== '') response.body = step.body
  }
  if (step.delaySeconds.trim() !== was.delaySeconds) {
    if (step.delaySeconds.trim() === '') delete response.fixedDelayMilliseconds
    else response.fixedDelayMilliseconds = Number(step.delaySeconds) * 1000
  }
  return response
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * What saving an edited scenario writes: steps added are created (with the request and catalog link of the step before
 * them), steps changed — answer, state, move, scenario name — are updated, steps removed are deleted. Mocks kept as is
 * are not touched. Assumes a valid draft.
 */
export function editChanges(loaded: LoadedScenario, draft: BuilderDraft): EditChange[] {
  const name = draft.name.trim()
  const creates: EditChange[] = []
  const updates: EditChange[] = []
  const fallback = draft.steps.find((s) => s.source)?.source ?? loaded.steps[0]?.source
  draft.steps.forEach((step, i) => {
    const state = stepState(draft.steps, i)
    const newState = targetOf(draft.steps, i)
    const scenario = { scenarioName: name, requiredScenarioState: state, ...(newState ? { newScenarioState: newState } : {}) }
    if (step.source) {
      const source = step.source
      const generated = source.name === undefined || source.name === `${loaded.name} — ${required(source) ?? ''}`
      const { newScenarioState: _old, ...rest } = toEditable(source)
      const stub = fromEditable(
        { ...rest, name: generated ? `${name} — ${state}` : source.name, response: editedResponse(source, step), ...scenario },
        linkOf(source),
      )
      if (canonical(stub) !== canonical(saved(source))) updates.push({ kind: 'update', step: i + 1, state, before: source, stub })
      return
    }
    const template = draft.steps.slice(0, i).reverse().find((s) => s.source)?.source ?? fallback
    if (!template) throw new Error('editChanges: a scenario needs at least one loaded step')
    const base = toEditable(template)
    const stub = fromEditable(
      {
        name: `${name} — ${state}`,
        request: base.request,
        ...(base.priority !== undefined ? { priority: base.priority } : {}),
        response: freshResponse(step),
        ...scenario,
      },
      linkOf(template),
    )
    creates.push({ kind: 'create', step: i + 1, state, stub })
  })
  const kept = new Set(draft.steps.map((s) => s.source?.id).filter(Boolean))
  const deletes: EditChange[] = loaded.steps
    .filter((s) => s.source && !kept.has(s.source.id))
    .map((s) => ({ kind: 'delete', before: s.source! }))
  return [...creates, ...updates, ...deletes]
}

// ── The mocks list, grouped by scenario ───────────────────────────────────────

export type MockRow = { kind: 'mock'; stub: StubMapping } | { kind: 'scenario'; name: string; mocks: StubMapping[] }

/**
 * The rows of the mocks list: a scenario's mocks become one group, placed where its first mock is, its mocks in
 * transition order; other mocks stay as they come. Works on whatever list it is given (one page of it, too).
 */
export function groupMocks(stubs: StubMapping[]): MockRow[] {
  const rows: MockRow[] = []
  const groups = new Map<string, StubMapping[]>()
  for (const stub of stubs) {
    const name = typeof stub.scenarioName === 'string' && stub.scenarioName !== '' ? stub.scenarioName : undefined
    if (!name) {
      rows.push({ kind: 'mock', stub })
      continue
    }
    let group = groups.get(name)
    if (!group) {
      group = []
      groups.set(name, group)
      rows.push({ kind: 'scenario', name, mocks: group })
    }
    group.push(stub)
  }
  for (const group of groups.values()) {
    const order = stateOrder(group)
    const at = (s: StubMapping) => {
      const state = required(s)
      return state === undefined ? order.length : order.indexOf(state)
    }
    group.sort((a, b) => at(a) - at(b) || byId(a, b))
  }
  return rows
}
