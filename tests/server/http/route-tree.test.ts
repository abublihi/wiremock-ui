import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { expect, test } from 'vitest'
import { routeTree } from '../../../src/routeTree.gen'

const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) })
const leaf = (path: string) => router.matchRoutes(path).at(-1)?.routeId

test('/api/mocks/reset-mine is not captured by /api/mocks/$id', () => {
  expect(leaf('/api/mocks/reset-mine')).toBe('/api/mocks/reset-mine')
  expect(leaf('/api/mocks/abc')).toBe('/api/mocks/$id')
  expect(leaf('/api/mocks/abc/duplicate')).toBe('/api/mocks/$id/duplicate')
  expect(leaf('/api/mocks/abc/history')).toBe('/api/mocks/$id/history')
  expect(leaf('/api/mocks/abc/restore')).toBe('/api/mocks/$id/restore')
})
