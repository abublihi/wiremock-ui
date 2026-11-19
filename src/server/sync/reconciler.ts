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
}

const versionOf = (s: StubMapping) => s.metadata?.wiremockUi?.version

export class Reconciler {
  private _lastSyncAt: Date | null = null
  private _lastError: string | null = null

  private readonly wiremock: WireMockClient
  private readonly store: MockStore
  private readonly intervalMs: number
  private readonly safetyNetMs: number
  private readonly batchSize: number
  private timers: NodeJS.Timeout[] = []
  private busy = false

  constructor(deps: Deps) {
    this.wiremock = deps.wiremock
    this.store = deps.store
    this.intervalMs = deps.intervalMs
    this.safetyNetMs = deps.safetyNetMs ?? 600_000
    this.batchSize = deps.batchSize ?? 500
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
    return this.fullSync()
  }

  async fullSync(): Promise<'synced' | 'skipped'> {
    const token = await this.store.acquireLock(LOCK, LOCK_TTL_MS)
    if (token === null) return 'skipped'
    try {
      const snapshot = await this.store.listAll()
      await this.importAll(snapshot)

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
      const changed = current.filter((s) => !before.has(s.id) || before.get(s.id) !== versionOf(s))
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
      return 'synced'
    } catch (err) {
      this._lastError = (err as Error).message
      logger.error({ err }, 'full sync failed')
      throw err
    } finally {
      await this.store.releaseLock(LOCK, token).catch((err) => logger.warn({ err }, 'sync lock release failed'))
    }
  }

  private async importAll(stubs: StubMapping[]): Promise<void> {
    for (let i = 0; i < stubs.length; i += this.batchSize) {
      await this.wiremock.importStubs(stubs.slice(i, i + this.batchSize), { deleteAllNotInImport: false })
    }
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
    await guarded(() => this.fullSync())()
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }
}
