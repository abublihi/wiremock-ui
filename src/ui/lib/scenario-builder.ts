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

/** Where a step moves the scenario after answering: the next step, nowhere, or a step picked by id (survives renames). */
export type MoveTo = 'next' | 'stay' | `step:${string}`

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
}

export type CatalogRequest = { kind: 'catalog'; integration: Integration; endpoint: Endpoint; isDefault: boolean; keyValue: string }
export type FreeRequest = { kind: 'free'; method: string; url: string }
export type BuilderDraft = { name: string; request: CatalogRequest | FreeRequest | null; steps: BuilderStep[] }

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

export function validateDraft(draft: BuilderDraft): BuilderErrors {
  const errors: BuilderErrors = { steps: {} }
  const name = draft.name.trim()
  if (name === '') errors.name = { key: 'builder.nameRequired' }
  else if (!isScenarioNameSettable(name)) errors.name = { key: 'builder.nameUnsettable' }

  const request = draft.request
  if (!request) errors.request = { key: 'builder.requestRequired' }
  else if (request.kind === 'catalog') {
    if (!request.isDefault && request.endpoint.lookup && request.keyValue.trim() === '') errors.request = { key: 'builder.keyRequired' }
  } else if (!request.url.trim().startsWith('/')) errors.request = { key: 'builder.urlInvalid' }
  const endpoint = request?.kind === 'catalog' ? request.endpoint : undefined

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

/** A scenario's last step: the mocks that answer in `from` and leave the scenario there (`exceptId`, the new step, aside). */
export function lastStepMocks(stubs: StubMapping[], scenario: string, from: string, exceptId?: string): StubMapping[] {
  return stubs.filter(
    (s) =>
      s.id !== exceptId &&
      s.scenarioName === scenario &&
      s.requiredScenarioState === from &&
      (s.newScenarioState === undefined || s.newScenarioState === '' || s.newScenarioState === from),
  )
}

/** The stub to save over a last-step mock so it moves the scenario on to `to` (the editor's Advanced save shape). */
export function movedOn(stub: StubMapping, to: string): Omit<StubMapping, 'id'> {
  return fromEditable({ ...toEditable(stub), newScenarioState: to }, linkOf(stub))
}
