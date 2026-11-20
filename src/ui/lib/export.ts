export type ExportScope = { scope: 'all' } | { scope: 'mine' } | { scope: 'integration'; integration: string }
export type ExportFormat = 'bundle' | 'mappings'

/** The mock list's filter as an export scope: an integration filter wins, then "My mocks", else everything. */
export function scopeFromFilter(filter: { owner: string; integration?: string; wiremockOnly: boolean }): ExportScope {
  if (filter.integration) return { scope: 'integration', integration: filter.integration }
  if (!filter.wiremockOnly && filter.owner === 'me') return { scope: 'mine' }
  return { scope: 'all' }
}

/** GET /api/export: a same-origin link the browser downloads (the session cookie is enough for a GET). */
export function exportUrl(scope: ExportScope, format: ExportFormat): string {
  const params = new URLSearchParams({ scope: scope.scope })
  if (scope.scope === 'integration') params.set('integration', scope.integration)
  params.set('format', format)
  return `/api/export?${params.toString()}`
}
