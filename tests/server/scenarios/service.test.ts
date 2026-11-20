import { expect, test } from 'vitest'
import type { AuditLog } from '../../../src/server/audit/log'
import { ScenarioService } from '../../../src/server/scenarios/service'
import type { MockStore } from '../../../src/server/store/types'
import type { WireMockClient } from '../../../src/server/wiremock/client'
import type { StubMapping } from '../../../src/server/wiremock/types'

const stub = (id: string, extra: Record<string, unknown>): StubMapping => ({ id, request: {}, response: {}, ...extra })
const audit: AuditLog = { record: async () => {}, list: async () => ({ entries: [], nextCursor: null }) }

test('lists states in transition order from Started, unreachable states last; live state from WireMock, Started when WireMock lacks it', async () => {
  const stubs = [
    stub('d', { scenarioName: 'ship', requiredScenarioState: 'shipped', newScenarioState: 'delivered' }),
    stub('a', { scenarioName: 'ship', requiredScenarioState: 'Started', newScenarioState: 'paid' }),
    stub('c', { scenarioName: 'ship', requiredScenarioState: 'paid', newScenarioState: 'shipped' }),
    stub('e', { scenarioName: 'ship', requiredScenarioState: 'lost' }),
    stub('b', { scenarioName: 'other' }),
    stub('f', { name: 'plain' }),
  ]
  const store = { listAll: async () => stubs } as unknown as MockStore
  const wiremock = { listScenarios: async () => [{ name: 'ship', state: 'paid', possibleStates: [] }] } as unknown as WireMockClient
  const list = await new ScenarioService({ store, wiremock, audit }).list()
  expect(list.map((s) => [s.name, s.state, s.possibleStates])).toEqual([
    ['other', 'Started', ['Started']],
    ['ship', 'paid', ['Started', 'paid', 'shipped', 'delivered', 'lost']],
  ])
  expect(list[1].mocks.map((m) => m.id)).toEqual(['a', 'c', 'd', 'e'])
})

test('each mock carries its method and URL for the diagram labels', async () => {
  const stubs = [
    stub('a', { name: 'Pending', scenarioName: 's', requiredScenarioState: 'Started', newScenarioState: 'ok', request: { method: 'POST', urlPath: '/pay/1' } }),
    stub('b', { scenarioName: 's', requiredScenarioState: 'ok', request: { method: 'GET', urlPathTemplate: '/pay/{id}' } }),
    stub('c', { scenarioName: 's', request: { urlPattern: '/x.*' } }),
    stub('d', { scenarioName: 's', request: {} }),
  ]
  const store = { listAll: async () => stubs } as unknown as MockStore
  const wiremock = { listScenarios: async () => [] } as unknown as WireMockClient
  const [s] = await new ScenarioService({ store, wiremock, audit }).list()
  expect(s!.mocks).toEqual([
    { id: 'a', name: 'Pending', method: 'POST', url: '/pay/1', requiredState: 'Started', newState: 'ok' },
    { id: 'b', method: 'GET', url: '/pay/{id}', requiredState: 'ok' },
    { id: 'c', url: '/x.*' },
    { id: 'd' },
  ])
})
