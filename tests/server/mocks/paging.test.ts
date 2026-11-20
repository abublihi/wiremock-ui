import { expect, test } from 'vitest'
import { MAX_PAGE_LIMIT, newestFirst, pageMocks } from '../../../src/server/mocks/paging'
import type { StubMapping } from '../../../src/server/wiremock/types'

const stub = (id: string, updatedAt: string, extra: Record<string, unknown> = {}): StubMapping => ({
  id,
  request: { method: 'GET', urlPath: `/${id}` },
  response: { status: 200 },
  metadata: { wiremockUi: { owner: 'ana', version: 1, updatedAt, updatedBy: 'ana', source: 'ui' } },
  ...extra,
})

// Minute n of a fixed day, so a bigger n is newer.
const at = (n: number) => new Date(Date.UTC(2026, 10, 20, 0, n)).toISOString()

test('newestFirst sorts by updatedAt, newest first, ties by id so every driver pages the same', () => {
  const list = [stub('b', at(1)), stub('a', at(1)), stub('c', at(2))]
  expect(list.sort(newestFirst).map((s) => s.id)).toEqual(['c', 'a', 'b'])
})

test('stubs with no update time (made in WireMock) keep the store order, after timed ones', () => {
  const bare = (id: string) => ({ id, request: {}, response: { status: 200 } }) as StubMapping
  const list = [bare('z'), bare('a'), stub('t', at(1)), bare('m')]
  expect(list.sort(newestFirst).map((s) => s.id)).toEqual(['t', 'z', 'a', 'm'])
})

test('a scenario is one row placed where its newest mock is, with all its mocks on that page', () => {
  // Newest first: m5, s-flow(step 3), m4, m3, s-flow(step 2), m2, s-flow(step 1), m1
  const list = [
    stub('m1', at(1)),
    stub('f1', at(2), { scenarioName: 'flow' }),
    stub('m2', at(3)),
    stub('f2', at(4), { scenarioName: 'flow' }),
    stub('m3', at(5)),
    stub('m4', at(6)),
    stub('f3', at(7), { scenarioName: 'flow' }),
    stub('m5', at(8)),
  ].sort(newestFirst)
  const first = pageMocks(list, { limit: 2, offset: 0 })
  expect(first.items.map((s) => s.id)).toEqual(['m5', 'f3', 'f2', 'f1'])
  expect(first).toMatchObject({ total: 6, totalMocks: 8, offset: 0, limit: 2 })
  expect(pageMocks(list, { limit: 2, offset: 2 }).items.map((s) => s.id)).toEqual(['m4', 'm3'])
  expect(pageMocks(list, { limit: 2, offset: 4 }).items.map((s) => s.id)).toEqual(['m2', 'm1'])
  expect(pageMocks(list, { limit: 2, offset: 6 }).items).toEqual([])
})

test('baseline counts the matching mocks owned by baseline, across every page', () => {
  const base = (id: string, n: number) => {
    const s = stub(id, at(n))
    s.metadata!.wiremockUi!.owner = 'baseline'
    return s
  }
  const list = [base('a', 1), stub('b', at(2)), { id: 'c', request: {}, response: {} } as StubMapping].sort(newestFirst)
  // A stub without wiremockUi metadata is a baseline mock too (the list's owner rule).
  expect(pageMocks(list, { limit: 1, offset: 0 }).baseline).toBe(2)
})

test('pages of 50 over 1,000 mocks cover every mock exactly once', () => {
  const list: StubMapping[] = []
  for (let i = 0; i < 1000; i++) {
    list.push(stub(`m${String(i).padStart(4, '0')}`, at(i % 600), i % 100 < 3 ? { scenarioName: `s${Math.floor(i / 100)}` } : {}))
  }
  list.sort(newestFirst)
  const first = pageMocks(list, { limit: 50, offset: 0 })
  // 10 scenarios of 3 mocks each count as 10 rows: 970 + 10.
  expect(first.total).toBe(980)
  const seen: string[] = []
  for (let offset = 0; offset < first.total; offset += 50) seen.push(...pageMocks(list, { limit: 50, offset }).items.map((s) => s.id))
  expect(seen).toHaveLength(1000)
  expect(new Set(seen).size).toBe(1000)
  expect(MAX_PAGE_LIMIT).toBe(200)
})
