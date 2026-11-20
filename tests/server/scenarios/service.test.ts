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
