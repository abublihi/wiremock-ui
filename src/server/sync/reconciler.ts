import type { AuditLog } from '../audit/log'
import { logger } from '../logger'
import type { MockStore } from '../store/types'
import type { WireMockClient } from '../wiremock/client'
import type { StubMapping } from '../wiremock/types'
import { MARKER_ID, markerStub } from './marker'

const LOCK = 'sync:lock'
const LOCK_TTL_MS = 60_000

type Deps = {
  wiremock: WireMockClient
  store: MockStore
  intervalMs: number
  safetyNetMs?: number
  batchSize?: number
  audit?: AuditLog
}

const versionOf = (s: StubMapping) => s.metadata?.wiremockUi?.version
const isBaseline = (s: StubMapping) => (s.metadata?.wiremockUi?.owner ?? 'baseline') === 'baseline'

/**
 * WireMock 3.13.1 breaks ties between equal-priority matching stubs by insertion: the stub added last
 * wins, an OVERWRITE import keeps a stub's old position, and within one import call the earlier entry
 * wins (tests/server/wiremock/precedence.test.ts). This is the order stubs must be *added* in so that
 * person-owned mocks beat baseline mocks and the most recently updated person mock wins.
 */
export function precedenceOrder(stubs: StubMapping[]): StubMapping[] {
  const key = (s: StubMapping) => `${isBaseline(s) ? 0 : 1}|${s.metadata?.wiremockUi?.updatedAt ?? ''}|${s.id}`
  return [...stubs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

export class Reconciler {
  private _lastSyncAt: Date | null = null
  private _lastError: string | null = null

  private readonly wiremock: WireMockClient
  private readonly store: MockStore
  private readonly intervalMs: number
  private readonly safetyNetMs: number
  private readonly batchSize: number
  private readonly audit?: AuditLog
  private timers: NodeJS.Timeout[] = []
  private busy = false

  constructor(deps: Deps) {
    this.wiremock = deps.wiremock
    this.store = deps.store
    this.intervalMs = deps.intervalMs
    this.safetyNetMs = deps.safetyNetMs ?? 600_000
    this.batchSize = deps.batchSize ?? 500
    this.audit = deps.audit
  }

  get lastSyncAt(): Date | null {
    return this._lastSyncAt
  }

  get lastError(): string | null {
    return this._lastError
  }

  async check(): Promise<'ok' | 'synced' | 'skipped'> {
    if ((await this.wiremock.getStub(MARKER_ID)) !== null) return 'ok'
    logger.warn('wiremock marker missing, running full sync')
    return this.fullSync({ audit: true })
  }

  /** `audit` records a `sync` entry on success; only startup and marker-triggered syncs ask for it. */
  async fullSync(opts: { audit?: boolean } = {}): Promise<'synced' | 'skipped'> {
    const token = await this.store.acquireLock(LOCK, LOCK_TTL_MS)
    if (token === null) return 'skipped'
    try {
      const snapshot = precedenceOrder(await this.store.listAll())
      const present = new Set(await this.wiremock.listStubIds())
      await this.importAll(snapshot)
      // A baseline stub WireMock did not have was just added on top of the person-owned stubs it already had
      // (e.g. ones saved after a WireMock reset); re-add those so they win again.
      if (snapshot.some((s) => isBaseline(s) && !present.has(s.id))) {
        await this.readd(snapshot.filter((s) => !isBaseline(s) && present.has(s.id)))
      }

      const known = new Set(snapshot.map((s) => s.id))
      for (const id of await this.wiremock.listStubIds()) {
        if (known.has(id)) continue
        // A mock saved after the snapshot is in the store: leave it alone.
        if (id !== MARKER_ID && (await this.store.get(id)) !== null) continue
        await this.wiremock.deleteStub(id)
      }

      // Catch up with saves that raced the import.
      const before = new Map(snapshot.map((s) => [s.id, versionOf(s)]))
      const current = await this.store.listAll()
      const currentIds = new Set(current.map((s) => s.id))
      const changed = precedenceOrder(current.filter((s) => !before.has(s.id) || before.get(s.id) !== versionOf(s)))
      await this.importAll(changed)
      // Mocks deleted during the sync were just re-imported from the snapshot: remove them again.
      for (const id of before.keys()) {
        if (!currentIds.has(id) && (await this.store.get(id)) === null) await this.wiremock.deleteStub(id)
      }

      await this.wiremock.importStubs([markerStub()], { deleteAllNotInImport: false })
      // If WireMock was reset since the last import, the marker would vouch for an empty WireMock.
      const expected = (await this.store.listAll()).length + 1
      const actual = (await this.wiremock.listStubIds()).length
      // More is fine (a save raced the sync); fewer means WireMock lost stubs.
      if (actual < expected) {
        await this.wiremock.deleteStub(MARKER_ID)
        throw new Error(`WireMock changed during sync (expected at least ${expected} stubs, found ${actual}); will re-sync`)
      }
      this._lastSyncAt = new Date()
      this._lastError = null
      logger.info({ stubs: snapshot.length }, 'full sync done')
      if (opts.audit) {
        await this.audit
          ?.record({ actor: 'system', action: 'sync', details: { stubs: snapshot.length } })
          .catch((err) => logger.error({ err }, 'audit record failed'))
      }
      return 'synced'
    } catch (err) {
      this._lastError = (err as Error).message
      logger.error({ err }, 'full sync failed')
      throw err
    } finally {
      await this.store.releaseLock(LOCK, token).catch((err) => logger.warn({ err }, 'sync lock release failed'))
    }
  }

  /** Adds `stubs` so that later entries take precedence (each batch is sent reversed: within one call the earlier entry wins). */
  private async importAll(stubs: StubMapping[]): Promise<void> {
    for (let i = 0; i < stubs.length; i += this.batchSize) {
      await this.wiremock.importStubs(stubs.slice(i, i + this.batchSize).reverse(), { deleteAllNotInImport: false })
    }
  }

  /** Delete + add (OVERWRITE alone keeps the old position), oldest first, using the latest stored copy. */
  private async readd(stubs: StubMapping[]): Promise<void> {
    for (const stub of stubs) {
      const latest = await this.store.get(stub.id)
      if (!latest) continue
      await this.wiremock.deleteStub(stub.id)
      await this.wiremock.importStubs([latest], { deleteAllNotInImport: false })
    }
  }

  /**
   * Re-adds every person-owned mock so it sits above baseline mocks added after it (import, seed).
   * Each mock is briefly absent from WireMock while it is moved.
   */
  async repositionPersonMocks(): Promise<void> {
    await this.readd(precedenceOrder((await this.store.listAll()).filter((s) => !isBaseline(s))))
  }

  async start(): Promise<void> {
    const guarded = (fn: () => Promise<unknown>) => async () => {
      if (this.busy) return
      this.busy = true
      try {
        await fn()
      } catch (err) {
        logger.error({ err }, 'reconcile tick failed')
      } finally {
        this.busy = false
      }
    }
    this.timers.push(
      setInterval(guarded(() => this.check()), this.intervalMs).unref(),
      setInterval(guarded(() => this.fullSync()), this.safetyNetMs).unref(),
    )
    // A failed first sync is logged and recorded in lastError; the timers keep retrying.
    await guarded(() => this.fullSync({ audit: true }))()
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }
}
