import { bootRuntime, type Runtime } from '../../src/server/runtime'
import { login as loginHandler } from '../../src/server/http/handlers/session'
import { startRedis, startWireMock } from './containers'

export const URL_ = 'http://ui.test'

export const basic = (user: string, pw: string) => `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`

export const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${URL_}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })

export async function startTestRuntime(adminUser = 'ui-admin', adminPassword = 'ui-admin-pass') {
  const wm = await startWireMock()
  const redis = await startRedis()
  const rt = await bootRuntime({
    WIREMOCK_URL: wm.url,
    WIREMOCK_ADMIN_USER: wm.user,
    WIREMOCK_ADMIN_PASSWORD: wm.password,
    REDIS_URL: redis.url,
    ADMIN_USER: adminUser,
    ADMIN_PASSWORD: adminPassword,
    SESSION_SECRET: 'x',
    TRUST_PROXY: 'true',
  })
  return {
    rt,
    wm,
    redis,
    async stop() {
      rt.reconciler.stop()
      await rt.stores.close()
      await redis.stop()
      await wm.stop().catch(() => {})
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
