import { z } from 'zod'
import { ConfigError } from './errors'
import { isHttpUrl, trimTrailingSlashes } from './url'

export type Config = {
  wiremockUrl: string
  /** Where clients reach WireMock's stub port (curl commands, docs). Never fetched by the server. */
  wiremockPublicUrl: string
  wiremockAdminUser?: string
  wiremockAdminPassword?: string
  /** `none` = WireMock-only mode (spec A10): WireMock holds the mocks, everything else lives in memory. */
  storeDriver: 'redis' | 'sqlite' | 'none'
  /** Set when storeDriver is redis. */
  redisUrl?: string
  sqlitePath: string
  /**
   * The first account, created on the first start when there are no accounts. Optional with a store: without it the
   * first admin is made with `wiremock-ui create-admin`. Required in WireMock-only mode (accounts live in memory).
   */
  adminUser?: string
  adminPassword?: string
  sessionSecret: string
  syncIntervalSeconds: number
  bootTimeoutSeconds: number
  trustProxy: boolean
  publicUiUrl?: string
  seedPath?: string
  seedPrune: boolean
  /** RECORDING_ALLOWED (default true): false turns recording and snapshots off (spec A12). */
  recordingAllowed: boolean
}

const DEFAULT_SQLITE_PATH = './data/wiremock-ui.db'

const required = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`)

const boolean = (name: string, fallback = false) =>
  z
    .string()
    .transform((v) => v.toLowerCase())
    .pipe(z.enum(['true', 'false', '1', '0'], { error: `${name} must be true, false, 1 or 0` }))
    .transform((v) => v === 'true' || v === '1')
    .default(fallback)

const schema = z.object({
  WIREMOCK_URL: z.string().min(1).default('http://localhost:8080'),
  WIREMOCK_PUBLIC_URL: z.string().min(1).optional(),
  WIREMOCK_ADMIN_USER: z.string().min(1).optional(),
  WIREMOCK_ADMIN_PASSWORD: z.string().min(1).optional(),
  STORE_DRIVER: z.string().optional(),
  REDIS_URL: z.string().min(1).optional(),
  SQLITE_PATH: z.string().min(1).default(DEFAULT_SQLITE_PATH),
  ADMIN_USER: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  SESSION_SECRET: required('SESSION_SECRET'),
  SYNC_INTERVAL_SECONDS: z.coerce
    .number({ error: 'SYNC_INTERVAL_SECONDS must be a positive number' })
    .positive('SYNC_INTERVAL_SECONDS must be a positive number')
    .default(5),
  BOOT_TIMEOUT_SECONDS: z.coerce
    .number({ error: 'BOOT_TIMEOUT_SECONDS must be a positive integer' })
    .int('BOOT_TIMEOUT_SECONDS must be a positive integer')
    .positive('BOOT_TIMEOUT_SECONDS must be a positive integer')
    .default(60),
  TRUST_PROXY: boolean('TRUST_PROXY'),
  PUBLIC_UI_URL: z.string().min(1).optional(),
  SEED_PATH: z.string().min(1).optional(),
  SEED_PRUNE: boolean('SEED_PRUNE'),
  RECORDING_ALLOWED: boolean('RECORDING_ALLOWED', true),
})

/** Every environment variable loadConfig reads (the README's configuration table is checked against it). */
export const CONFIG_ENV_VARS: readonly string[] = Object.keys(schema.shape)

/** Whether a restart deletes baseline mocks missing from the seed: SEED_PRUNE with a SEED_PATH, outside WireMock-only mode. */
export const prunesBaseline = (config: Pick<Config, 'seedPrune' | 'seedPath' | 'storeDriver'>): boolean =>
  config.seedPrune && Boolean(config.seedPath) && config.storeDriver !== 'none'

/** Treats empty strings as unset so `FOO=` in an env file behaves like absent. */
const withoutEmpty = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ''))

/** Spec A9: Redis when REDIS_URL is set, otherwise SQLite. WireMock-only mode (A10) is never a default. */
function storeDriverOf(cleaned: Record<string, string>, problems: string[]): string {
  const driver = cleaned.STORE_DRIVER ?? (cleaned.REDIS_URL ? 'redis' : 'sqlite')
  if (driver !== 'redis' && driver !== 'sqlite' && driver !== 'none') {
    problems.push(`STORE_DRIVER must be "redis", "sqlite" or "none", got "${driver}"`)
  } else if (driver === 'redis' && !cleaned.REDIS_URL) {
    problems.push('REDIS_URL is required when STORE_DRIVER=redis')
  }
  return driver
}

export type StoreSettings = Pick<Config, 'storeDriver' | 'redisUrl' | 'sqlitePath'>

/**
 * Only the store settings (STORE_DRIVER, REDIS_URL, SQLITE_PATH), for the `wiremock-ui` command: it opens the same
 * store as the server without needing the server's other settings (SESSION_SECRET, WireMock).
 */
export function loadStoreSettings(env: Record<string, string | undefined>): StoreSettings {
  const cleaned = withoutEmpty(env)
  const problems: string[] = []
  const driver = storeDriverOf(cleaned, problems)
  if (problems.length > 0) throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`)
  return { storeDriver: driver as Config['storeDriver'], redisUrl: cleaned.REDIS_URL, sqlitePath: cleaned.SQLITE_PATH ?? DEFAULT_SQLITE_PATH }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const cleaned = withoutEmpty(env)
  const parsed = schema.safeParse(cleaned)
  const problems: string[] = []
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(issue.message.startsWith(String(issue.path[0])) ? issue.message : `${String(issue.path[0])}: ${issue.message}`)
  }
  if (Boolean(cleaned.WIREMOCK_ADMIN_USER) !== Boolean(cleaned.WIREMOCK_ADMIN_PASSWORD)) {
    problems.push('WIREMOCK_ADMIN_USER and WIREMOCK_ADMIN_PASSWORD must be set together or both left unset')
  }
  const data = parsed.success ? parsed.data : undefined

  const driver = storeDriverOf(cleaned, problems)
  if (driver === 'none') {
    // WireMock-only mode keeps accounts in memory: the env vars are the only way to have one.
    if (!cleaned.ADMIN_USER) problems.push('ADMIN_USER is required in WireMock-only mode (STORE_DRIVER=none)')
    if (!cleaned.ADMIN_PASSWORD) problems.push('ADMIN_PASSWORD is required in WireMock-only mode (STORE_DRIVER=none)')
  } else if (Boolean(cleaned.ADMIN_USER) !== Boolean(cleaned.ADMIN_PASSWORD)) {
    problems.push('ADMIN_USER and ADMIN_PASSWORD must be set together or both left unset (then create the first admin with `wiremock-ui create-admin`)')
  }

  const publicUrl = cleaned.WIREMOCK_PUBLIC_URL
  if (publicUrl !== undefined && !isHttpUrl(publicUrl)) problems.push('WIREMOCK_PUBLIC_URL must be an http:// or https:// URL')

  if (problems.length > 0 || !data) {
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`)
  }

  return {
    wiremockUrl: data.WIREMOCK_URL,
    wiremockPublicUrl: trimTrailingSlashes(data.WIREMOCK_PUBLIC_URL ?? data.WIREMOCK_URL),
    wiremockAdminUser: data.WIREMOCK_ADMIN_USER,
    wiremockAdminPassword: data.WIREMOCK_ADMIN_PASSWORD,
    storeDriver: driver as Config['storeDriver'],
    redisUrl: data.REDIS_URL,
    sqlitePath: data.SQLITE_PATH,
    adminUser: data.ADMIN_USER,
    adminPassword: data.ADMIN_PASSWORD,
    sessionSecret: data.SESSION_SECRET,
    syncIntervalSeconds: data.SYNC_INTERVAL_SECONDS,
    bootTimeoutSeconds: data.BOOT_TIMEOUT_SECONDS,
    trustProxy: data.TRUST_PROXY,
    publicUiUrl: data.PUBLIC_UI_URL,
    seedPath: data.SEED_PATH,
    seedPrune: data.SEED_PRUNE,
    recordingAllowed: data.RECORDING_ALLOWED,
  }
}
