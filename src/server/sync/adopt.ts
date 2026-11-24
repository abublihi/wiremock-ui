import { safeRecord, type AuditLog } from '../audit/log'
import { AppError } from '../errors'
import { logger } from '../logger'
import type { MockStore } from '../store/types'
import type { WireMockClient } from '../wiremock/client'
import type { StubMapping, WireMockUiMeta } from '../wiremock/types'
import { MARKER_ID } from './marker'
import { recordingProxyMatcher } from '../recording/proxy'
import { ADOPTION_PENDING, SYNC_LOCK, SYNC_LOCK_TTL_MS } from './reconciler'

/** Owner of a stub taken over from WireMock that names none itself. */
export const ADOPTED_OWNER = 'wiremock'

const liveStubs = async (wiremock: WireMockClient) => {
  const isRecordingProxy = await recordingProxyMatcher(wiremock)
  return (await wiremock.listStubs()).filter((s) => s.id !== MARKER_ID && !isRecordingProxy(s))
}

/**
 * Decides at boot whether WireMock's stubs must be adopted, and records the decision in the store before
 * anything else is written: adoption is due when the store has no mocks and WireMock has stubs, and stays due
 * (across failed or interrupted boots) until `adoptMissing` completes. Returns whether it is due.
 */
export async function markAdoptionIfDue(wiremock: WireMockClient, store: MockStore): Promise<boolean> {
  if (await store.getFlag(ADOPTION_PENDING)) return true
  if ((await store.listAll()).length > 0) return false
  if ((await liveStubs(wiremock)).length === 0) return false
  await store.setFlag(ADOPTION_PENDING, true)
  return true
}

type Deps = { wiremock: WireMockClient; store: MockStore; audit: AuditLog; now?: () => Date }

/**
 * Stores every WireMock stub the store does not have yet, with its id (source `adopt`; the owner its wiremock-ui
 * metadata names, else `wiremock`; its tags and group from its metadata). The stubs
 * are already in WireMock, so nothing is written there (their `persistent` setting included). Clears the pending
 * flag when done. Runs under the sync lock: when another instance holds it, that instance adopts (or syncs; the
 * flag keeps its sync from deleting) and this one skips.
 */
export async function adoptMissing(deps: Deps): Promise<number> {
  const { store } = deps
  const token = await store.acquireLock(SYNC_LOCK, SYNC_LOCK_TTL_MS)
  if (token === null) {
    logger.info('adoption deferred: the sync lock is held (another instance is syncing or adopting); a later full sync retries it')
    return 0
  }
  try {
    // Another instance may have finished it while we waited.
    if (!(await store.getFlag(ADOPTION_PENDING))) return 0
    const count = await adoptLocked(deps)
    await store.setFlag(ADOPTION_PENDING, false)
    if (count > 0) {
      logger.info({ count }, `adopted ${count} existing WireMock stubs`)
      await safeRecord(deps.audit, { actor: 'system', action: 'adopt', details: { count } })
    }
    return count
  } finally {
    await store.releaseLock(SYNC_LOCK, token).catch((err) => logger.warn({ err }, 'sync lock release failed'))
  }
}

async function adoptLocked(deps: Deps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))().toISOString()
  let count = 0
  for (const live of await liveStubs(deps.wiremock)) {
    if ((await deps.store.get(live.id)) !== null) continue
    const { uuid: _uuid, ...stub } = live
    const ui = stub.metadata?.wiremockUi as Partial<WireMockUiMeta> | undefined
    const wiremockUi: WireMockUiMeta = {
      // An old link is kept for the start-up migration to turn into tags (src/server/catalog/migrate-store.ts).
      integration: typeof ui?.integration === 'string' ? ui.integration : undefined,
      endpoint: typeof ui?.endpoint === 'string' ? ui.endpoint : undefined,
      ...(Array.isArray(ui?.tags) ? { tags: ui.tags.filter((t): t is string => typeof t === 'string') } : {}),
      ...(ui?.group !== undefined ? { group: ui.group } : {}),
      owner: typeof ui?.owner === 'string' && ui.owner !== '' ? ui.owner : ADOPTED_OWNER,
      version: 1,
      updatedAt: now,
      updatedBy: 'system',
      source: 'adopt',
    }
    try {
      await deps.store.save({ ...stub, metadata: { ...stub.metadata, wiremockUi } } as StubMapping, 0)
      count++
    } catch (err) {
      // Saved meanwhile (a UI save racing the boot): theirs stands.
      if (err instanceof AppError && err.status === 409) continue
      throw err
    }
  }
  return count
}
