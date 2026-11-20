/**
 * Where an old `/catalog…` URL lives now: the same path under `/integrations`, with its search and hash kept.
 * `rest` is what followed `/catalog/` ('' for `/catalog` itself).
 */
export function integrationsHref(rest: string | undefined, searchStr = '', hash = ''): string {
  const tail = (rest ?? '').replace(/^\/+/, '')
  const search = searchStr === '' || searchStr.startsWith('?') ? searchStr : `?${searchStr}`
  const fragment = hash === '' || hash.startsWith('#') ? hash : `#${hash}`
  return `/integrations${tail ? `/${tail}` : ''}${search}${fragment}`
}
