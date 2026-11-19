import { loadConfig, type Config } from './config'
import { ConfigError, UpstreamError } from './errors'
import { logger } from './logger'
import { importBundle } from './bundle/importer'
import { readBundleFromPath } from './bundle/parse'
import { CatalogService } from './catalog/service'
import { RequestJournal } from './requests/journal'
import { MockService } from './mocks/service'
import type { AuditLog } from './audit/log'
import { createStores, type MockStore, type Stores } from './store'
import { UserService } from './users/service'
import { Reconciler } from './sync/reconciler'
import { WireMockClient } from './wiremock/client'
import { assertWireMockReady } from './wiremock/startup'

export type Runtime = {
  config: Config
  wiremock: WireMockClient
  store: MockStore
  stores: Stores
  users: UserService
  audit: AuditLog
  mocks: MockService
  catalog: CatalogService
  requests: RequestJournal
  reconciler: Reconciler
}

export type BootDeps = {
  fetch?: typeof fetch
  createStores?: (config: Config) => Stores
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
      const candidate = open(config)
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
    const audit = stores.audit
    const users = new UserService({ users: stores.users, audit })
    await users.ensureFirstAdmin(config.adminUser, config.adminPassword)
    const mocks = new MockService({ wiremock, store, audit })
    const catalog = new CatalogService({ catalog: stores.catalog, audit, mocks: store })
    const requests = new RequestJournal({ wiremock, catalog, audit })
    if (config.seedPath) {
      try {
        const { bundle, skipped } = await readBundleFromPath(config.seedPath)
        for (const entry of skipped) logger.warn({ entry, seedPath: config.seedPath }, 'seed entry skipped: unreadable (dangling symlink?)')
        if (skipped.length > 0 && config.seedPrune) logger.warn({ skipped: skipped.length }, 'prune skipped: seed folder had unreadable entries')
        const report = await importBundle(
          bundle,
          { catalog, mocks, store, audit },
          { actor: 'system', prune: config.seedPrune, source: 'seed', unreadable: skipped.length },
        )
        logger.info({ report, seedPath: config.seedPath }, 'seed imported')
      } catch (err) {
        throw new ConfigError(`Seed import from ${config.seedPath} failed: ${(err as Error).message}`)
      }
    }
    const reconciler = new Reconciler({ wiremock, store, audit, intervalMs: config.syncIntervalSeconds * 1000 })
    await reconciler.start()
    return { config, wiremock, store, stores, users, audit, mocks, catalog, requests, reconciler }
  } catch (err) {
    await stores?.close().catch(() => {})
    logger.error({ err }, 'runtime boot failed')
    throw err
  }
}

let runtime: Promise<Runtime> | undefined

export function getRuntime(): Promise<Runtime> {
  if (!runtime) {
    const attempt = bootRuntime(process.env)
    runtime = attempt
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
}
