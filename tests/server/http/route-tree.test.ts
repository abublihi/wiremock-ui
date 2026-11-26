import { QueryClient } from '@tanstack/react-query'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { expect, test } from 'vitest'
import { routeTree } from '../../../src/routeTree.gen'

const router = createRouter({ routeTree, context: { queryClient: new QueryClient() }, history: createMemoryHistory({ initialEntries: ['/'] }) })
const leaf = (path: string) => router.matchRoutes(path).at(-1)?.routeId

test('/api/mocks/reset-mine is not captured by /api/mocks/$id', () => {
  expect(leaf('/api/mocks/reset-mine')).toBe('/api/mocks/reset-mine')
  expect(leaf('/api/mocks/abc')).toBe('/api/mocks/$id')
  expect(leaf('/api/mocks/abc/duplicate')).toBe('/api/mocks/$id/duplicate')
  expect(leaf('/api/mocks/abc/history')).toBe('/api/mocks/$id/history')
  expect(leaf('/api/mocks/abc/restore')).toBe('/api/mocks/$id/restore')
})

test('mock-group and tag routes resolve to their own files', () => {
  expect(leaf('/api/mock-groups')).toBe('/api/mock-groups')
  expect(leaf('/api/mock-groups/g1')).toBe('/api/mock-groups/$id')
  expect(leaf('/api/mock-groups/preview')).toBe('/api/mock-groups/preview')
  expect(leaf('/api/tags')).toBe('/api/tags')
})

test('the retired Integrations API answers through the /api splat', () => {
  expect(leaf('/api/integrations')).toBe('/api/$')
  expect(leaf('/api/integrations/pay/endpoints')).toBe('/api/$')
})

test('import route resolves', () => {
  expect(leaf('/api/import')).toBe('/api/import')
})

test('/api/requests/count is not captured by /api/requests/$id', () => {
  expect(leaf('/api/requests')).toBe('/api/requests')
  expect(leaf('/api/requests/count')).toBe('/api/requests/count')
  expect(leaf('/api/requests/abc')).toBe('/api/requests/$id')
  expect(leaf('/api/requests/abc/near-misses')).toBe('/api/requests/$id/near-misses')
})

test('audit route resolves', () => {
  expect(leaf('/api/audit')).toBe('/api/audit')
})

test('test-request and scenario routes resolve to their own files', () => {
  expect(leaf('/api/test-request')).toBe('/api/test-request')
  expect(leaf('/api/scenarios')).toBe('/api/scenarios')
  expect(leaf('/api/scenarios/reset')).toBe('/api/scenarios/reset')
  expect(leaf('/api/scenarios/order-flow/state')).toBe('/api/scenarios/$name/state')
  expect(leaf('/api/scenarios/reset/state')).toBe('/api/scenarios/$name/state')
})

test('the scenario name reaches the handler decoded', () => {
  expect(router.matchRoutes('/api/scenarios/order%20flow/state').at(-1)?.params).toMatchObject({ name: 'order flow' })
})

test('the quick-mock preview is not captured by /api/mocks/$id', () => {
  expect(leaf('/api/mocks/preview')).toBe('/api/mocks/preview')
})

test('old Integrations and Catalog URLs land on the redirect routes', () => {
  expect(leaf('/integrations')).toBe('/integrations/')
  expect(leaf('/integrations/nic')).toBe('/integrations/$')
  expect(leaf('/integrations/nic/endpoints/fetch/edit')).toBe('/integrations/$')
  expect(leaf('/catalog')).toBe('/catalog/')
  expect(leaf('/catalog/nic')).toBe('/catalog/$')
  expect(leaf('/catalog/nic/endpoints/fetch/edit')).toBe('/catalog/$')
})

test('recording routes are not captured by /api/recordings/$id', () => {
  expect(leaf('/api/recordings')).toBe('/api/recordings')
  for (const name of ['status', 'start', 'stop', 'snapshot']) expect(leaf(`/api/recordings/${name}`)).toBe(`/api/recordings/${name}`)
  expect(leaf('/api/recordings/abc')).toBe('/api/recordings/$id')
  expect(leaf('/api/recordings/abc/accept')).toBe('/api/recordings/$id/accept')
  expect(leaf('/api/recordings/abc/discard')).toBe('/api/recordings/$id/discard')
})

test('/api/requests/unmatched-count is not captured by /api/requests/$id', () => {
  expect(leaf('/api/requests/unmatched-count')).toBe('/api/requests/unmatched-count')
})
