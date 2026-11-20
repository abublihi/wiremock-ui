import { safeRecord, type AuditLog } from '../audit/log'
import { NotFoundError, ValidationError } from '../errors'
import type { MockStore } from '../store/types'
import { isScenarioNameSettable, type WireMockClient } from '../wiremock/client'
import type { StubMapping } from '../wiremock/types'

export const STARTED = 'Started'

/** One mock of a scenario: its label (name, method, URL as matched) and the transition it makes. */
export type ScenarioMock = { id: string; name?: string; method?: string; url?: string; requiredState?: string; newState?: string }

const URL_FIELDS = ['url', 'urlPath', 'urlPathTemplate', 'urlPattern', 'urlPathPattern'] as const

export type Scenario = {
  name: string
  /** Live state from WireMock; `Started` while WireMock has not loaded the scenario's mocks yet. */
  state: string
  /** `Started` first, then the states its mocks lead to in transition order, then any unreachable ones (A–Z). */
  possibleStates: string[]
  /** False when WireMock 3.13.1 cannot address the name (spaces and the like): only Reset all reaches it. */
  settable: boolean
  mocks: ScenarioMock[]
}

type Deps = { wiremock: WireMockClient; store: MockStore; audit: AuditLog }

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** Breadth-first from Started along required → new transitions; states it never reaches follow, A–Z. */
function transitionOrder(scenario: Omit<Scenario, 'state'>): string[] {
  const order = [STARTED]
  for (let i = 0; i < order.length; i++) {
    const next = scenario.mocks
      .filter((m) => (m.requiredState ?? order[i]) === order[i] && m.newState)
      .map((m) => m.newState as string)
      .sort()
    for (const state of next) if (!order.includes(state)) order.push(state)
  }
  const rest = scenario.possibleStates.filter((s) => !order.includes(s)).sort()
  return [...order, ...rest]
}

/**
 * Scenarios in every store mode: names and each scenario's state graph come from the stored mocks (in WireMock-only
 * mode the store is WireMock), the current state from WireMock's `GET /__admin/scenarios`.
 */
export class ScenarioService {
  constructor(private readonly deps: Deps) {}

  async list(): Promise<Scenario[]> {
    const [stubs, live] = await Promise.all([this.deps.store.listAll(), this.deps.wiremock.listScenarios()])
    const liveState = new Map(live.map((s) => [s.name, s.state]))
    return this.graph(stubs)
      .map((s) => ({ ...s, state: liveState.get(s.name) ?? STARTED }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  private graph(stubs: StubMapping[]): Omit<Scenario, 'state'>[] {
    const byName = new Map<string, Omit<Scenario, 'state'>>()
    for (const stub of [...stubs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const name = str(stub.scenarioName)
      if (!name) continue
      let scenario = byName.get(name)
      if (!scenario) {
        scenario = { name, possibleStates: [STARTED], settable: isScenarioNameSettable(name), mocks: [] }
        byName.set(name, scenario)
      }
      const requiredState = str(stub.requiredScenarioState)
      const newState = str(stub.newScenarioState)
      for (const state of [requiredState, newState]) {
        if (state && !scenario.possibleStates.includes(state)) scenario.possibleStates.push(state)
      }
      const request = (stub.request ?? {}) as Record<string, unknown>
      const method = str(request.method)
      const url = URL_FIELDS.map((f) => str(request[f])).find(Boolean)
      scenario.mocks.push({
        id: stub.id,
        ...(stub.name ? { name: stub.name } : {}),
        ...(method ? { method } : {}),
        ...(url ? { url } : {}),
        ...(requiredState ? { requiredState } : {}),
        ...(newState ? { newState } : {}),
      })
    }
    for (const scenario of byName.values()) scenario.possibleStates = transitionOrder(scenario)
    return [...byName.values()]
  }

  private async find(name: string): Promise<Scenario> {
    const scenario = (await this.list()).find((s) => s.name === name)
    if (!scenario) throw new NotFoundError(`Scenario ${JSON.stringify(name)} not found: no mock uses it`)
    return scenario
  }

  /** Moves a scenario to one of its states (`Started` resets it). */
  async setState(name: string, state: string, actor: string): Promise<Scenario> {
    const scenario = await this.find(name)
    if (!scenario.possibleStates.includes(state)) {
      throw new ValidationError(`state must be one of: ${scenario.possibleStates.join(', ')}`)
    }
    await this.deps.wiremock.setScenarioState(name, state)
    await safeRecord(this.deps.audit, { actor, action: 'scenario.set-state', target: name, details: { state } })
    return { ...scenario, state }
  }

  /** Every scenario back to `Started`. */
  async resetAll(actor: string): Promise<void> {
    await this.deps.wiremock.resetScenarios()
    await safeRecord(this.deps.audit, { actor, action: 'scenario.reset-all', target: '*' })
  }
}
