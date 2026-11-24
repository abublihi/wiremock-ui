import { logger } from '../logger'
import type { MockService } from '../mocks/service'
import type { MockStore } from '../store/types'
import { isLinked, migrateLinkedStubs, type LegacyEndpoint } from './migrate'
import type { CatalogStore } from './types'

/**
 * The one-time move off integrations (see migrate.ts), run on every start: stubs still linked to an integration or
 * endpoint get tags and, for an endpoint with a key, become one mock with several responses. A start with nothing
 * linked does nothing, so it only ever changes anything once. The old catalog is read for the endpoints' keys and
 * names, never written.
 */
/** Every endpoint the retired catalog still holds (none when it can't be read). */
export async function legacyEndpoints(catalog: CatalogStore): Promise<LegacyEndpoint[]> {
  const endpoints: LegacyEndpoint[] = []
  for (const integration of await catalog.listIntegrations().catch(() => [])) {
    for (const e of await catalog.listEndpoints(integration.key).catch(() => [])) {
      endpoints.push({ integration: e.integration, key: e.key, name: e.name, ...(e.lookup ? { lookup: e.lookup } : {}) })
    }
  }
  return endpoints
}

export async function migrateCatalogLinks(deps: { store: MockStore; mocks: MockService; catalog: CatalogStore }): Promise<number> {
  const linked = (await deps.store.listAll()).filter(isLinked)
  if (linked.length === 0) return 0
  const endpoints = await legacyEndpoints(deps.catalog)
  let rewritten = 0
  for (const stub of migrateLinkedStubs(linked, endpoints)) {
    try {
      await deps.mocks.rewrite(stub, 'system')
      rewritten++
    } catch (err) {
      logger.error({ err, id: stub.id }, 'moving a mock off its integration failed; it keeps its old link and is tried again on the next start')
    }
  }
  logger.info({ mocks: rewritten }, 'integrations retired: their mocks now carry tags, endpoint mocks became mocks with several responses')
  return rewritten
}
