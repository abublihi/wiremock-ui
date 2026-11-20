import { safeRecord, type AuditLog } from '../audit/log'
import { guessIntegration } from '../bundle/importer'
import type { CatalogService } from '../catalog/service'
import { AppError } from '../errors'
import { logger } from '../logger'
import type { MockService } from '../mocks/service'
import type { MockStore } from '../store/types'
import type { WireMockClient } from '../wiremock/client'
import type { StubMapping } from '../wiremock/types'
import { MARKER_ID } from './marker'
import { SYNC_LOCK, SYNC_LOCK_TTL_MS } from './reconciler'

/** Owner of a stub taken over from WireMock that names none itself. */
export const ADOPTED_OWNER = 'wiremock'

/**
 * The stubs to adopt at boot: everything WireMock serves (but the marker) when the store has no mocks
 * yet. Once the store holds a mock it is the source of truth and nothing is adopted (empty result).
 */
export async function stubsToAdopt(wiremock: WireMockClient, store: MockStore): Promise<StubMapping[]> {
  if ((await store.listAll()).length > 0) return []
  return (await wiremock.listStubs()).filter((s) => s.id !== MARKER_ID)
}

/**
 * Takes `stubs` into the store with their ids (source `adopt`; the owner their wiremock-ui metadata names, else
 * `wiremock`; integration guessed from the catalog prefixes) so the first full sync keeps them instead of deleting
 * them. Runs under the sync lock: when another instance holds it, that instance adopts (or syncs) and this one
 * skips. Stubs the store gained meanwhile (a seed with the same id) are left alone.
 */
export async function adoptStubs(
  stubs: StubMapping[],
  deps: { mocks: MockService; store: MockStore; catalog: CatalogService; audit: AuditLog },
): Promise<number> {
  if (stubs.length === 0) return 0
  const token = await deps.store.acquireLock(SYNC_LOCK, SYNC_LOCK_TTL_MS)
  if (token === null) {
    logger.info({ stubs: stubs.length }, 'adoption skipped: another instance holds the sync lock and adopts')
    return 0
  }
  try {
    return await adoptLocked(stubs, deps)
  } finally {
    await deps.store.releaseLock(SYNC_LOCK, token).catch((err) => logger.warn({ err }, 'sync lock release failed'))
  }
}

async function adoptLocked(
  stubs: StubMapping[],
  deps: { mocks: MockService; store: MockStore; catalog: CatalogService; audit: AuditLog },
): Promise<number> {
  const prefixes = (await deps.catalog.listIntegrations()).map((i) => ({ key: i.key, prefix: i.prefix }))
  let count = 0
  for (const raw of stubs) {
    if ((await deps.store.get(raw.id)) !== null) continue
    const { uuid: _uuid, ...stub } = raw
    const ui = stub.metadata?.wiremockUi
    const integration = typeof ui?.integration === 'string' ? ui.integration : guessIntegration(stub as StubMapping, prefixes)
    const owner = typeof ui?.owner === 'string' && ui.owner !== '' ? ui.owner : ADOPTED_OWNER
    const candidate = {
      ...stub,
      metadata: { ...stub.metadata, wiremockUi: { ...ui, integration } },
    } as StubMapping
    try {
      if ((await deps.mocks.upsertImported(candidate, owner, 'adopt', 'system')) !== 'unchanged') count++
    } catch (err) {
      // Another instance adopted it first (409): theirs stands.
      if (err instanceof AppError && err.status === 409) continue
      throw err
    }
  }
  if (count > 0) {
    logger.info({ count }, `adopted ${count} existing WireMock stubs`)
    await safeRecord(deps.audit, { actor: 'system', action: 'adopt', details: { count } })
  }
  return count
}
