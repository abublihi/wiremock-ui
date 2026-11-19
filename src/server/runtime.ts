import { loadConfig, type Config } from './config'
import { ConfigError } from './errors'
import { logger } from './logger'
import { MockService } from './mocks/service'
import { createStore, type MockStore } from './store'
import { Reconciler } from './sync/reconciler'
import { WireMockClient } from './wiremock/client'
import { assertWireMockReady } from './wiremock/startup'

export type Runtime = {
  config: Config
  wiremock: WireMockClient
  store: MockStore
  mocks: MockService
  reconciler: Reconciler
}

export async function bootRuntime(env: Record<string, string | undefined>): Promise<Runtime> {
  let store: MockStore | undefined
  try {
    const config = loadConfig(env)
    const wiremock = new WireMockClient({
      baseUrl: config.wiremockUrl,
      user: config.wiremockAdminUser,
      password: config.wiremockAdminPassword,
    })
    await assertWireMockReady(wiremock, config.wiremockUrl)
    store = createStore(config)
    if (!(await store.ping())) throw new ConfigError('Store unreachable')
    const mocks = new MockService({ wiremock, store })
    const reconciler = new Reconciler({ wiremock, store, intervalMs: config.syncIntervalSeconds * 1000 })
    await reconciler.start()
    return { config, wiremock, store, mocks, reconciler }
  } catch (err) {
    await store?.close().catch(() => {})
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
