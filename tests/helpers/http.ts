import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootRuntime, type Runtime } from '../../src/server/runtime'
import { login as loginHandler } from '../../src/server/http/handlers/session'
import { startRedis, startWireMock, type WireMockHandle } from './containers'

export const URL_ = 'http://ui.test'

export const basic = (user: string, pw: string) => `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`

export const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${URL_}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })

/** The driver the HTTP tests run on: `server-sqlite` and `server-none` set TEST_STORE_DRIVER; Redis otherwise. */
export const TEST_DRIVER = (process.env.TEST_STORE_DRIVER ?? 'redis') as 'redis' | 'sqlite' | 'none'
/** WireMock-only mode (spec A10): one account, no history, no sync. Tests that need more skip themselves. */
export const STORELESS = TEST_DRIVER === 'none'

async function startStore(): Promise<{ env: Record<string, string>; stop(): Promise<void> }> {
  if (STORELESS) return { env: { STORE_DRIVER: 'none' }, stop: async () => {} }
  if (TEST_DRIVER === 'sqlite') {
    const dir = mkdtempSync(join(tmpdir(), 'wmui-http-'))
    return {
      env: { STORE_DRIVER: 'sqlite', SQLITE_PATH: join(dir, 'wiremock-ui.db') },
      stop: async () => rmSync(dir, { recursive: true, force: true }),
    }
  }
  const redis = await startRedis()
  return { env: { REDIS_URL: redis.url }, stop: () => redis.stop() }
}

/** `opts.wm`: a WireMock the caller started (and stops); otherwise one is started here. */
export async function startTestRuntime(adminUser = 'ui-admin', adminPassword = 'ui-admin-pass', opts: { wm?: WireMockHandle } = {}) {
  const wm = opts.wm ?? (await startWireMock())
  const store = await startStore()
  const rt = await bootRuntime({
    WIREMOCK_URL: wm.url,
    WIREMOCK_ADMIN_USER: wm.user,
    WIREMOCK_ADMIN_PASSWORD: wm.password,
    ...store.env,
    ADMIN_USER: adminUser,
    ADMIN_PASSWORD: adminPassword,
    SESSION_SECRET: 'x',
    TRUST_PROXY: 'true',
  })
  return {
    rt,
    wm,
    async stop() {
      rt.reconciler?.stop()
      await rt.stores.close()
      await store.stop()
      if (!opts.wm) await wm.stop().catch(() => {})
    },
  }
}

let nextIp = 1

/** Logs in through the real handler; returns the Cookie header value and the CSRF token. */
export async function login(rt: Runtime, username: string, password: string, ip = `10.9.0.${nextIp++}`) {
  const res = await loginHandler(rt, req('/api/session', 'POST', { username, password }, { 'X-Forwarded-For': ip }))
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  const { csrfToken } = await res.json()
  return { cookie, csrf: csrfToken as string }
}

/**
 * A signed-in session for `username` (created with password-1). In WireMock-only mode there is only the bootstrap
 * account, so every "user" is that one: callers read the name back from `username`.
 */
export async function signIn(rt: Runtime, username: string, adminUser = 'ui-admin', adminPassword = 'ui-admin-pass') {
  if (STORELESS) return { ...(await login(rt, adminUser, adminPassword)), username: adminUser }
  await rt.users.create({ username, password: 'password-1' }, adminUser)
  return { ...(await login(rt, username, 'password-1')), username }
}
