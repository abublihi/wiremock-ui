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

test('catalog routes resolve to their own files', () => {
  expect(leaf('/api/integrations')).toBe('/api/integrations')
  expect(leaf('/api/integrations/pay')).toBe('/api/integrations/$key')
  expect(leaf('/api/integrations/pay/endpoints')).toBe('/api/integrations/$key/endpoints')
  expect(leaf('/api/integrations/pay/endpoints/get-user')).toBe('/api/integrations/$key/endpoints/$endpoint')
})

test('catalog build routes resolve to their own files', () => {
  expect(leaf('/api/integrations/pay/endpoints/get-user/mocks')).toBe('/api/integrations/$key/endpoints/$endpoint/mocks')
  expect(leaf('/api/integrations/pay/endpoints/get-user/preview')).toBe('/api/integrations/$key/endpoints/$endpoint/preview')
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
