import { loadConfig, type Config } from './config'
import { ConfigError, UpstreamError } from './errors'
import { logger } from './logger'
import { importBundle } from './bundle/importer'
import { readBundleFromPath } from './bundle/parse'
import { legacyEndpoints, migrateCatalogLinks } from './catalog/migrate-store'
import { RequestJournal } from './requests/journal'
import { MockService } from './mocks/service'
import type { AuditLog } from './audit/log'
import { ScenarioService } from './scenarios/service'
import { RecordingService } from './recording/service'
import { createStores, type MockStore, type Stores } from './store'
import { UserService } from './users/service'
import { adoptMissing, markAdoptionIfDue } from './sync/adopt'
import { Reconciler } from './sync/reconciler'
import { WireMockClient } from './wiremock/client'
import { assertWireMockReady } from './wiremock/startup'

/** How to make the first account when ADMIN_USER / ADMIN_PASSWORD are not set (logged, and shown on the sign-in page). */
export const FIRST_ADMIN_COMMAND = 'wiremock-ui create-admin'

export type Runtime = {
  config: Config
  wiremock: WireMockClient
  store: MockStore
  stores: Stores
  users: UserService
  audit: AuditLog
  mocks: MockService
  requests: RequestJournal
  scenarios: ScenarioService
  /** Recording and snapshots with a review list (spec A12). */
  recordings: RecordingService
  /** null in WireMock-only mode (spec A10): WireMock is the store, so there is nothing to sync. */
  reconciler: Reconciler | null
}

export type BootDeps = {
  fetch?: typeof fetch
  createStores?: (config: Config, opts: { wiremock: WireMockClient }) => Stores
  sleep?: (ms: number) => Promise<void>
}

const BACKOFF_START_MS = 500
const BACKOFF_CAP_MS = 5000
const PING_TIMEOUT_MS = 2000

/** Retries only reachability failures (UpstreamError, store ping false) until the deadline. */
async function untilReachable<T>(
  what: string,
  deadline: number,
  sleep: (ms: number) => Promise<void>,
  attempt: () => Promise<T>,
): Promise<T> {
  let delay = BACKOFF_START_MS
  for (;;) {
    try {
      return await attempt()
    } catch (err) {
      if (!(err instanceof UpstreamError) || Date.now() + delay > deadline) throw err
      logger.warn({ err: err.message, retryInMs: delay }, `${what} not reachable yet, retrying`)
      await sleep(delay)
      delay = Math.min(delay * 2, BACKOFF_CAP_MS)
    }
  }
}

export async function bootRuntime(
  env: Record<string, string | undefined>,
  deps: BootDeps = {},
): Promise<Runtime> {
  let stores: Stores | undefined
  try {
    const config = loadConfig(env)
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const deadline = Date.now() + config.bootTimeoutSeconds * 1000
    const wiremock = new WireMockClient({
      baseUrl: config.wiremockUrl,
      user: config.wiremockAdminUser,
      password: config.wiremockAdminPassword,
      fetch: deps.fetch,
    })
    await untilReachable('WireMock', deadline, sleep, () =>
      assertWireMockReady(wiremock, config.wiremockUrl, deps.fetch),
    )
    const open = deps.createStores ?? createStores
    stores = await untilReachable('Store', deadline, sleep, async () => {
      const candidate = open(config, { wiremock })
      try {
        let timer: NodeJS.Timeout | undefined
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new UpstreamError('Store ping timed out')), PING_TIMEOUT_MS)
        })
        try {
          if (!(await Promise.race([candidate.ping(), timeout]))) throw new UpstreamError('Store unreachable')
        } finally {
          clearTimeout(timer)
        }
      } catch (err) {
        // Not awaited: closing a hung connection can itself hang.
        void candidate.close().catch(() => {})
        throw err instanceof UpstreamError ? err : new UpstreamError(`Store unreachable: ${(err as Error).message}`)
      }
      return candidate
    })
    const store = stores.mocks
    // The retired catalog: read only, to move old mocks off their integrations (src/server/catalog/migrate-store.ts).
    const legacyCatalog = stores.catalog
    const audit = stores.audit
    const wiremockOnly = config.storeDriver === 'none'
    const users = new UserService({ users: stores.users, audit, fixedAccounts: wiremockOnly })
    if (config.adminUser && config.adminPassword) await users.ensureFirstAdmin(config.adminUser, config.adminPassword)
    else if ((await stores.users.countUsers()) === 0) {
      logger.warn(
        { command: FIRST_ADMIN_COMMAND },
        'no accounts yet and ADMIN_USER / ADMIN_PASSWORD are not set: create the first admin with "wiremock-ui create-admin" (in Docker: docker exec -it <container> wiremock-ui create-admin)',
      )
    }
    const reserved = await users.reservedAccounts().catch(() => [])
    if (reserved.length > 0) {
      logger.warn(
        { accounts: reserved },
        'accounts with reserved names exist (baseline, system and wiremock own mocks no person made): create another account for that person and disable this one',
      )
    }
    const mocks = new MockService({ wiremock, store, audit, storeIsWireMock: wiremockOnly })
    const requests = new RequestJournal({ wiremock, audit })
    const scenarios = new ScenarioService({ wiremock, store, audit })
    const recordings = new RecordingService({ wiremock, store: stores.recordings, locks: store, mocks, audit, config })
    const reconciler = wiremockOnly
      ? null
      : new Reconciler({ wiremock, store, audit, intervalMs: config.syncIntervalSeconds * 1000, adopt: () => adoptMissing({ wiremock, store, audit }) })
    // Decided (and recorded durably) before the seed writes anything: an empty store takes over what WireMock
    // already serves, and a boot that stops part-way leaves the decision for the next one.
    const adoptionPending = reconciler ? await markAdoptionIfDue(wiremock, store) : false
    if (config.seedPath) {
      try {
        const { bundle, skipped } = await readBundleFromPath(config.seedPath)
        for (const entry of skipped) logger.warn({ entry, seedPath: config.seedPath }, 'seed entry skipped: unreadable (dangling symlink?)')
        if (skipped.length > 0 && config.seedPrune) logger.warn({ skipped: skipped.length }, 'prune skipped: seed folder had unreadable entries')
        const idless = bundle.mocks.filter((m) => m.id === undefined && m.uuid === undefined).length
        if (idless > 0 && !config.seedPrune) {
          logger.warn(
            { count: idless, seedPath: config.seedPath },
            'seed mocks without an id get a content-derived id, so an edited one is added next to its old version; give seed mocks fixed ids or set SEED_PRUNE=true',
          )
        }
        // Never delete stubs from the user's own WireMock.
        if (wiremockOnly && config.seedPrune) logger.warn({ seedPath: config.seedPath }, 'SEED_PRUNE is ignored in WireMock-only mode')
        const report = await importBundle(
          bundle,
          { legacyEndpoints: () => legacyEndpoints(legacyCatalog), mocks, store, audit, reposition: reconciler ? () => reconciler.repositionPersonMocks() : undefined },
          { actor: 'system', prune: config.seedPrune && !wiremockOnly, source: 'seed', unreadable: skipped.length },
        )
        logger.info({ report, seedPath: config.seedPath }, 'seed imported')
      } catch (err) {
        throw new ConfigError(`Seed import from ${config.seedPath} failed: ${(err as Error).message}`)
      }
    }
    // After the seed and adoption (both may bring mocks still linked to integrations); before the first full sync.
    if (adoptionPending) await adoptMissing({ wiremock, store, audit })
    await migrateCatalogLinks({ store, mocks, catalog: legacyCatalog })
    if (reconciler) await reconciler.start()
    else logger.info({ wiremockUrl: config.wiremockUrl }, 'WireMock-only mode: mocks are read from and written to WireMock; accounts and audit are kept in memory')
    return { config, wiremock, store, stores, users, audit, mocks, requests, scenarios, recordings, reconciler }
  } catch (err) {
    await stores?.close().catch(() => {})
    logger.error({ err }, 'runtime boot failed')
    throw err
  }
}

let runtime: Promise<Runtime> | undefined

/**
 * The runtime this process booted last, kept on globalThis so it outlives a module reload. The dev server
 * re-evaluates this module when server code changes; without this, every older runtime kept its reconciler
 * timers running old code (which, for one, deleted WireMock's recording proxy as an unknown stub).
 */
const holder = globalThis as { __wiremockUiRuntime?: Promise<Runtime> }

/** Stops an earlier runtime's background work and closes its stores before a new one boots. */
export async function retire(previous: Promise<Runtime> | undefined): Promise<void> {
  if (!previous) return
  const old = await previous.catch(() => undefined)
  if (!old) return
  await old.reconciler?.stop()
  await old.stores?.close().catch((err: unknown) => logger.warn({ err }, 'closing the previous runtime failed'))
}

export function getRuntime(): Promise<Runtime> {
  if (!runtime) {
    const attempt = retire(holder.__wiremockUiRuntime).then(() => bootRuntime(process.env))
    runtime = attempt
    holder.__wiremockUiRuntime = attempt
    // A failed boot is not cached, so a later request can retry (dev server).
    attempt.catch(() => {
      if (runtime === attempt) runtime = undefined
    })
  }
  return runtime
}

/** Production start-up: boot once when the server loads; refuse to run if it fails. */
export function bootEagerly(): void {
  getRuntime().catch(() => process.exit(1))
  exitOnSignals()
}

/**
 * On SIGTERM/SIGINT (docker stop, Ctrl+C): stop the reconciler and close the stores, then exit. Without it an open
 * Redis connection kept the process alive until it was killed. Forced exit after `graceMs` if closing hangs.
 */
export function exitOnSignals(graceMs = 5_000, exit: (code: number) => void = (code) => process.exit(code)): void {
  let stopping = false
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'shutting down')
    setTimeout(() => exit(0), graceMs).unref()
    void retire(holder.__wiremockUiRuntime).finally(() => exit(0))
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
