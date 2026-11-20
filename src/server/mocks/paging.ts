import type { StubMapping } from '../wiremock/types'

/** The largest page `GET /api/mocks?limit=` accepts. */
export const MAX_PAGE_LIMIT = 200

export type MockPage = {
  /** The mocks of this page's rows, in list order (a scenario's mocks next to each other). */
  items: StubMapping[]
  /** Rows matching the filter: a mock is one row, a scenario (all its matching mocks) is one row. */
  total: number
  /** Mocks matching the filter. */
  totalMocks: number
  /** Matching mocks owned by baseline (or with no owner), across every page. */
  baseline: number
  offset: number
  limit: number
}

// Adopted stubs may carry any metadata, so anything but a string sorts as oldest.
const updatedAt = (s: StubMapping) => {
  const v: unknown = s.metadata?.wiremockUi?.updatedAt
  return typeof v === 'string' ? v : ''
}

/**
 * Newest change first; equal times by id, so every store driver returns the same order and pages never overlap.
 * Stubs with no time at all (made in WireMock, listed in WireMock-only mode) keep the store's order (WireMock's
 * own, newest first) instead of a random-looking id order; the sort is stable.
 */
export function newestFirst(a: StubMapping, b: StubMapping): number {
  const ta = updatedAt(a)
  const tb = updatedAt(b)
  if (ta === '' && tb === '') return 0
  return tb.localeCompare(ta) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

const scenarioOf = (s: StubMapping) => (typeof s.scenarioName === 'string' && s.scenarioName !== '' ? s.scenarioName : undefined)

/**
 * One page of rows from a sorted list. A scenario's mocks form one row, placed where its first (newest) mock is, so
 * paging never splits a scenario across pages; a page can hold more than `limit` mocks when it holds a scenario.
 */
export function pageMocks(sorted: StubMapping[], page: { limit: number; offset: number }): MockPage {
  const rows: StubMapping[][] = []
  const groups = new Map<string, StubMapping[]>()
  let baseline = 0
  for (const stub of sorted) {
    if ((stub.metadata?.wiremockUi?.owner ?? 'baseline') === 'baseline') baseline++
    const name = scenarioOf(stub)
    if (name === undefined) {
      rows.push([stub])
      continue
    }
    let group = groups.get(name)
    if (!group) {
      group = []
      groups.set(name, group)
      rows.push(group)
    }
    group.push(stub)
  }
  return {
    items: rows.slice(page.offset, page.offset + page.limit).flat(),
    total: rows.length,
    totalMocks: sorted.length,
    baseline,
    offset: page.offset,
    limit: page.limit,
  }
}
