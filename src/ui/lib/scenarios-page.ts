import type { Scenario } from '@/server/scenarios/service'

/** Scenario cards per page on the Scenarios page. */
export const SCENARIOS_PAGE_SIZE = 20

/**
 * The scenarios a search matches, case-insensitive: the scenario's name, any of its states (live or possible), and its
 * mocks' names and paths. An empty search matches all.
 */
export function filterScenarios(scenarios: Scenario[], query: string): Scenario[] {
  const q = query.trim().toLowerCase()
  if (q === '') return scenarios
  const has = (text: string | undefined) => text !== undefined && text.toLowerCase().includes(q)
  return scenarios.filter(
    (s) =>
      has(s.name) ||
      has(s.state) ||
      s.possibleStates.some(has) ||
      s.mocks.some((m) => has(m.name) || has(m.url) || has(m.requiredState) || has(m.newState)),
  )
}

/** How many pages `count` scenarios fill (at least 1). */
export const pageCount = (count: number, size = SCENARIOS_PAGE_SIZE) => Math.max(1, Math.ceil(count / size))

/** The 1-based page the scenario named `name` is on in `list`, or undefined when it is not there. */
export function pageOf(list: Scenario[], name: string, size = SCENARIOS_PAGE_SIZE): number | undefined {
  const at = list.findIndex((s) => s.name === name)
  return at === -1 ? undefined : Math.floor(at / size) + 1
}
