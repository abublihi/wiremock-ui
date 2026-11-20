import { expect, test } from 'vitest'
import { renameRecordedScenarios } from '../../../src/server/recording/scenarios'
import type { ReviewItem } from '../../../src/server/recording/types'

const item = (id: string, url: string, scenario?: [string, string, string?]): ReviewItem => ({
  id,
  method: 'GET',
  url,
  status: 200,
  bodySize: 0,
  stub: {
    request: { method: 'GET', urlPath: url.split('?')[0] },
    response: { status: 200 },
    ...(scenario ? { scenarioName: scenario[0], requiredScenarioState: scenario[1], ...(scenario[2] ? { newScenarioState: scenario[2] } : {}) } : {}),
  },
})
const at = new Date('2026-11-20T14:05:33Z')

test('renames each recorded scenario and its states consistently; plain stubs are left alone', () => {
  const out = renameRecordedScenarios(
    [
      item('a', '/api/orders?x=1', ['scenario-1-api-orders', 'Started', 'scenario-1-api-orders-2']),
      item('b', '/api/orders', ['scenario-1-api-orders', 'scenario-1-api-orders-2', 'scenario-1-api-orders-3']),
      item('c', '/api/orders', ['scenario-1-api-orders', 'scenario-1-api-orders-3']),
      item('d', '/'),
    ],
    [],
    at,
  )
  const n = 'GET-api-orders-recorded-2026-11-20-1405'
  expect(out.map((i) => [i.stub.scenarioName, i.stub.requiredScenarioState, i.stub.newScenarioState])).toEqual([
    [n, 'Started', `${n}-2`],
    [n, `${n}-2`, `${n}-3`],
    [n, `${n}-3`, undefined],
    [undefined, undefined, undefined],
  ])
})

test('a name already taken (by a mock or another review list) gets a numeric suffix; the root path has a name', () => {
  const taken = ['GET-api-orders-recorded-2026-11-20-1405', 'GET-api-orders-recorded-2026-11-20-1405-2']
  const out = renameRecordedScenarios(
    [item('a', '/api/orders', ['scenario-1-api-orders', 'Started']), item('b', '/', ['scenario-2', 'Started'])],
    taken,
    at,
  )
  expect(out.map((i) => i.stub.scenarioName)).toEqual(['GET-api-orders-recorded-2026-11-20-1405-3', 'GET-root-recorded-2026-11-20-1405'])
})
