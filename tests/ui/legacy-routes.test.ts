import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { Route as CatalogIndex } from '@/routes/catalog.index'
import { Route as CatalogSplat } from '@/routes/catalog.$'
import { integrationsHref } from '@/ui/lib/legacy-routes'

/** Runs a redirect route's beforeLoad and returns where it sends the browser. */
function target(route: { options: { beforeLoad?: unknown } }, splat: string | undefined, searchStr: string, hash = ''): string {
  const beforeLoad = route.options.beforeLoad as (ctx: unknown) => void
  try {
    beforeLoad({ params: { _splat: splat }, location: { searchStr, hash } })
  } catch (thrown) {
    expect(isRedirect(thrown)).toBe(true)
    const r = thrown as { options: { href: string; statusCode?: number } }
    expect(r.options.statusCode).toBe(301)
    return r.options.href
  }
  throw new Error('did not redirect')
}

describe('old /catalog URLs redirect to /integrations, keeping the search', () => {
  it.each([
    [undefined, '', '/integrations'],
    ['nic', '', '/integrations/nic'],
    ['nic/endpoints/new', '?next=mock', '/integrations/nic/endpoints/new?next=mock'],
    ['nic/endpoints/fetch-citizen/edit', '?a=1&b=two', '/integrations/nic/endpoints/fetch-citizen/edit?a=1&b=two'],
  ])('/catalog/%s%s → %s', (splat, search, href) => {
    expect(target(splat === undefined ? CatalogIndex : CatalogSplat, splat, search)).toBe(href)
  })

  it('keeps the hash too', () => {
    expect(target(CatalogSplat, 'nic', '?x=1', 'top')).toBe('/integrations/nic?x=1#top')
  })

  it('integrationsHref normalises its parts', () => {
    expect(integrationsHref('/nic/', 'x=1')).toBe('/integrations/nic/?x=1')
    expect(integrationsHref('', '', '')).toBe('/integrations')
  })
})
