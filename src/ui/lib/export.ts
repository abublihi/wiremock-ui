export type ExportScope = { scope: 'all' } | { scope: 'mine' } | { scope: 'tag'; tag: string }
export type ExportFormat = 'bundle' | 'mappings'

/** The mock list's filter as an export scope: a tag filter wins, then "My mocks", else everything. */
export function scopeFromFilter(filter: { owner: string; tag?: string; wiremockOnly: boolean }): ExportScope {
  if (filter.tag) return { scope: 'tag', tag: filter.tag }
  if (!filter.wiremockOnly && filter.owner === 'me') return { scope: 'mine' }
  return { scope: 'all' }
}

/** GET /api/export: a same-origin link the browser downloads (the session cookie is enough for a GET). */
export function exportUrl(scope: ExportScope, format: ExportFormat): string {
  const params = new URLSearchParams({ scope: scope.scope })
  if (scope.scope === 'tag') params.set('tag', scope.tag)
  params.set('format', format)
  return `/api/export?${params.toString()}`
}
