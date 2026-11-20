import type { ReviewItem, ReviewStub } from './types'

/**
 * WireMock names a recorded scenario after the request path (`scenario-1-api-orders`) and restarts the count with
 * every recording, so two recordings of one endpoint produce the same scenario name; accepting both would merge
 * their chains into one scenario. Each recorded scenario is renamed when its review list is made, to a name no
 * mock and no other review list uses: `GET-api-orders-recorded-2026-11-20-1405` (`-2`, `-3`… when taken).
 * The name only uses characters WireMock's admin API can set the state of. States keep WireMock's order: `Started`, then
 * WireMock's `<old name>-2`, `-3`… become `<new name>-2`, `-3`….
 */
export function renameRecordedScenarios(items: ReviewItem[], taken: Iterable<string>, at: Date): ReviewItem[] {
  const used = new Set(taken)
  const renamed = new Map<string, string>()
  const stamp = at.toISOString().replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}).*$/, '$1-$2$3')
  const nameFor = (item: ReviewItem, old: string) => {
    const known = renamed.get(old)
    if (known) return known
    const path = item.url.split('?')[0]
    const slug =
      path
        .replace(/[^A-Za-z0-9]+/g, '-')
        .slice(0, 60)
        .replace(/^-+/, '')
        .replace(/-+$/, '') || 'root'
    const method = /^[A-Za-z]+$/.test(item.method) ? item.method.toUpperCase() : 'ANY'
    const base = `${method}-${slug}-recorded-${stamp}`
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`
    used.add(name)
    renamed.set(old, name)
    return name
  }
  const state = (value: unknown, old: string, name: string) =>
    typeof value === 'string' && value.startsWith(`${old}-`) ? `${name}-${value.slice(old.length + 1)}` : value

  return items.map((item) => {
    const old = item.stub.scenarioName
    if (typeof old !== 'string') return item
    const name = nameFor(item, old)
    const stub: ReviewStub = { ...item.stub, scenarioName: name }
    if (stub.requiredScenarioState !== undefined) stub.requiredScenarioState = state(stub.requiredScenarioState, old, name)
    if (stub.newScenarioState !== undefined) stub.newScenarioState = state(stub.newScenarioState, old, name)
    return { ...item, stub }
  })
}
