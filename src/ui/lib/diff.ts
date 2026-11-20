import type { FieldDiff } from '@/server/requests/explain'

/** How one field of a near miss compares: `unchecked` is a matcher the server's simple checks can't evaluate. */
export type FieldState = 'match' | 'mismatch' | 'unchecked'
export type DiffRow = FieldDiff & { state: FieldState }

const stateOf = (matched: boolean | null): FieldState => (matched === true ? 'match' : matched === false ? 'mismatch' : 'unchecked')

/** The rows of a near-miss explanation: mismatches first (what to fix), the rest in the server's order. */
export function diffRows(diffs: FieldDiff[]): DiffRow[] {
  const rows = diffs.map((d) => ({ ...d, state: stateOf(d.matched) }))
  return [...rows.filter((r) => r.state === 'mismatch'), ...rows.filter((r) => r.state !== 'mismatch')]
}

export function diffSummary(rows: DiffRow[]): { total: number } & Record<FieldState, number> {
  const count = (state: FieldState) => rows.filter((r) => r.state === state).length
  return { total: rows.length, match: count('match'), mismatch: count('mismatch'), unchecked: count('unchecked') }
}
