#!/usr/bin/env node
// Seeds a large catalog through the API, for checking how the UI copes with many mocks:
// 10 integrations × 10 endpoints, and 1,000 mocks (100 per integration, 3 of them a scenario).
//
//   UI_URL=http://localhost:3000 UI_USER=admin UI_PASSWORD=… node scripts/seed-many.mjs
//
// Optional: INTEGRATIONS (10), ENDPOINTS (10 per integration), MOCKS (1000 in all), CONCURRENCY (8).
// Everything it makes uses the key prefix "perf-", so it is easy to find and delete.

const base = (process.env.UI_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const user = process.env.UI_USER ?? 'admin'
const password = process.env.UI_PASSWORD
if (!password) {
  console.error('Set UI_PASSWORD (and UI_USER, UI_URL) to an account on the UI')
  process.exit(1)
}
const INTEGRATIONS = Number(process.env.INTEGRATIONS ?? 10)
const ENDPOINTS = Number(process.env.ENDPOINTS ?? 10)
const MOCKS = Number(process.env.MOCKS ?? 1000)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)

// Sign in once and reuse the session: Basic auth checks the password (bcrypt) on every call, which makes
// thousands of calls slow.
const login = await fetch(`${base}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: user, password }),
})
if (!login.ok) {
  console.error(`Sign-in failed: ${login.status} ${await login.text()}`)
  process.exit(1)
}
const { csrfToken } = await login.json()
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ')
const headers = { Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' }

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

/** Runs `jobs` (functions returning promises) with at most CONCURRENCY at once. */
async function pool(jobs) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]()
    }),
  )
}

const pad = (n) => String(n).padStart(2, '0')
const started = Date.now()

const integrations = Array.from({ length: INTEGRATIONS }, (_, i) => ({ key: `perf-${pad(i + 1)}`, name: `Perf system ${pad(i + 1)}`, prefix: `/perf-${pad(i + 1)}` }))
for (const integration of integrations) await call('PUT', `/api/integrations/${integration.key}`, integration)

await pool(
  integrations.flatMap((integration) =>
    Array.from({ length: ENDPOINTS }, (_, e) => () =>
      call('PUT', `/api/integrations/${integration.key}/endpoints/items-${pad(e + 1)}`, {
        name: `Items ${pad(e + 1)}`,
        method: 'GET',
        path: `/items-${pad(e + 1)}`,
        pathType: 'exact',
        contentType: 'json',
        lookup: { location: 'query', expression: 'id' },
        exampleResponses: { 200: '{"ok":true}' },
        allowedStatuses: [200, 404],
      }),
    ),
  ),
)

const perIntegration = Math.floor(MOCKS / INTEGRATIONS)
const jobs = []
for (const integration of integrations) {
  for (let m = 0; m < perIntegration; m++) {
    const endpoint = `items-${pad((m % ENDPOINTS) + 1)}`
    const url = `${integration.prefix}/${endpoint}`
    // The first three mocks of each integration are one scenario's steps.
    const scenario =
      m < 3
        ? {
            scenarioName: `${integration.key} flow`,
            requiredScenarioState: ['Started', 'second', 'third'][m],
            ...(m < 2 ? { newScenarioState: ['second', 'third'][m] } : {}),
          }
        : {}
    jobs.push(() =>
      call('POST', '/api/mocks', {
        name: `${integration.name} mock ${m + 1}`,
        request: { method: 'GET', urlPath: url, queryParameters: { id: { equalTo: String(m + 1) } } },
        response: { status: m % 10 === 9 ? 404 : 200, jsonBody: { id: m + 1 }, headers: { 'Content-Type': 'application/json' } },
        metadata: { wiremockUi: { integration: integration.key, endpoint } },
        ...scenario,
      }),
    )
  }
}
await pool(jobs)

console.log(
  `Seeded ${integrations.length} integrations, ${integrations.length * ENDPOINTS} endpoints and ${jobs.length} mocks in ${((Date.now() - started) / 1000).toFixed(1)} s`,
)
