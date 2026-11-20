import { longestPrefixMatch } from '@/server/catalog/prefix'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { ReviewItem } from '@/server/recording/types'

/** The endpoint select's value for "create an endpoint from this request". */
export const NEW_ENDPOINT = '__new__'

/** What a review row will be accepted as: '' integration = a mock without one (opens in the quick form). */
export type RowChoice = { name: string; integration: string; endpoint: string }

const pathOf = (item: Pick<ReviewItem, 'url'>) => item.url.split('?')[0]
const rootOf = (integration: Integration) => (integration.prefix === '/' ? '' : integration.prefix)

/**
 * The integration whose prefix (longest first, never the catch-all "/") takes this request, and its endpoint
 * with the same method and exact path; a new endpoint when only the prefix matches; nothing otherwise.
 */
export function suggestLink(
  item: Pick<ReviewItem, 'url' | 'method'>,
  integrations: Integration[],
  endpoints: Record<string, Endpoint[] | undefined>,
): Pick<RowChoice, 'integration' | 'endpoint'> {
  const path = pathOf(item)
  const key = longestPrefixMatch([path], integrations.filter((i) => i.prefix !== '/'))
  const integration = integrations.find((i) => i.key === key)
  if (!integration) return { integration: '', endpoint: '' }
  const same = (endpoints[integration.key] ?? []).find(
    (e) => e.pathType === 'exact' && e.method === item.method && rootOf(integration) + e.path === path,
  )
  return { integration: integration.key, endpoint: same ? same.key : NEW_ENDPOINT }
}

/** Key and name of the endpoint "New endpoint" creates: method and the path under the integration's prefix. */
export function newEndpointFor(item: Pick<ReviewItem, 'url' | 'method'>, integration: Integration): { key: string; name: string } {
  const path = pathOf(item)
  const relative = integration.prefix !== '/' && path.startsWith(`${integration.prefix}/`) ? path.slice(integration.prefix.length) : path
  const slug = `${item.method}-${relative}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '')
  return { key: slug || 'recorded', name: `${item.method} ${relative}` }
}

export type AcceptItem = {
  id: string
  name?: string
  integration?: string
  endpoint?: string
  newEndpoint?: { key: string; name: string }
}

/**
 * The accept request's items. The server works through them in order, so the first row of a new endpoint
 * creates it and later rows for the same key simply link to it.
 */
export function acceptPayload(rows: (RowChoice & { item: ReviewItem })[], integrations: Integration[]): AcceptItem[] {
  const created = new Set<string>()
  return rows.map(({ item, name, integration, endpoint }) => {
    const out: AcceptItem = { id: item.id }
    if (name.trim()) out.name = name.trim()
    const target = integrations.find((i) => i.key === integration)
    if (!target) return out
    out.integration = target.key
    if (endpoint === NEW_ENDPOINT) {
      const fresh = newEndpointFor(item, target)
      const id = `${target.key}/${fresh.key}`
      if (created.has(id)) out.endpoint = fresh.key
      else {
        created.add(id)
        out.newEndpoint = fresh
      }
    } else if (endpoint) out.endpoint = endpoint
    return out
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
