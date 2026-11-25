#!/usr/bin/env node
// Load and performance test: how the UI, its store and WireMock behave with many mocks.
//
//   node scripts/load-test.mjs --sizes 1000,5000,10000,20000 --driver sqlite,redis,none
//
// For each driver and size it starts its own WireMock 3.13.1 (admin auth on), Redis 7.4 when the driver is redis,
// and the built app (`npm run build` first, unless --no-build), seeds the mocks with POST /api/import, measures,
// and tears everything down. Prints a Markdown table at the end.
//
// Options:
//   --sizes 1000,5000          mock counts (default 1000,5000,10000,20000)
//   --driver sqlite|redis|none comma list (default sqlite); `none` only runs sizes up to --none-max
//   --none-max 5000            largest size for the `none` driver (WireMock-only mode reads WireMock on every call)
//   --port 3400                app port; WireMock gets port+1, Redis port+2 (3900 and 18900 are refused)
//   --runs 10                  timed runs per API call
//   --wm-requests 200          timed requests to random mocks (plus a quarter as many unmatched ones)
//   --json out.json            also writes the raw results
//   --no-build                 skip `npm run build` (dist/ must be current)
//   --cpu-prof DIR             runs the app with --cpu-prof; profiles land in DIR when the app stops
//   --serve                    seeds the first driver/size, prints the URL, keeps running until Ctrl+C
//                              (for measuring the UI in a browser); sign in as admin / $LOAD_TEST_PASSWORD
//
// Needs docker, node >= 22.12 and nothing else (no new dependencies).

import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WIREMOCK_IMAGE = 'wiremock/wiremock:3.13.1'
const REDIS_IMAGE = 'redis:7.4-alpine'
const MARKER_ID = '5e1f0000-0000-4000-8000-00000000c0de'
const MAX_IMPORT_BYTES = 8 * 1024 * 1024 // the API refuses bodies over 10 MB

const { values: opts } = parseArgs({
  options: {
    sizes: { type: 'string', default: '1000,5000,10000,20000' },
    driver: { type: 'string', default: 'sqlite' },
    'none-max': { type: 'string', default: '5000' },
    port: { type: 'string', default: '3400' },
    runs: { type: 'string', default: '10' },
    'wm-requests': { type: 'string', default: '200' },
    json: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
    'cpu-prof': { type: 'string' },
    serve: { type: 'boolean', default: false },
  },
})

const SIZES = opts.sizes.split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
const DRIVERS = opts.driver.split(',').map((d) => d.trim())
for (const d of DRIVERS) if (!['sqlite', 'redis', 'none'].includes(d)) throw new Error(`unknown driver ${d}`)
const NONE_MAX = Number(opts['none-max'])
const RUNS = Number(opts.runs)
const WM_REQUESTS = Number(opts['wm-requests'])
const APP_PORT = Number(opts.port)
const WM_PORT = APP_PORT + 1
const REDIS_PORT = APP_PORT + 2
for (const p of [APP_PORT, WM_PORT, REDIS_PORT]) {
  if (p === 3900 || p === 18900) throw new Error(`port ${p} is reserved; pick another --port`)
}

const APP = `http://127.0.0.1:${APP_PORT}`
const WM = `http://127.0.0.1:${WM_PORT}`
const WM_USER = 'loadadmin'
const WM_PASSWORD = randomBytes(12).toString('hex')
const WM_AUTH = `Basic ${Buffer.from(`${WM_USER}:${WM_PASSWORD}`).toString('base64')}`
const ADMIN_USER = 'admin'
const ADMIN_PASSWORD = process.env.LOAD_TEST_PASSWORD || randomBytes(12).toString('hex')
const tag = `${process.pid}`

// ---------------------------------------------------------------- process and container bookkeeping

const containers = new Set()
let app = null // { child, logs }
const tempDirs = new Set()

const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.error(`[load-test ${new Date().toISOString().slice(11, 19)}]`, ...a)

function removeContainer(name) {
  try {
    sh('docker', ['rm', '-f', name])
  } catch {
    /* already gone */
  }
  containers.delete(name)
}

async function stopApp() {
  if (!app) return
  const { child } = app
  app = null
  if (child.exitCode !== null) return
  const exited = new Promise((r) => child.once('exit', r))
  child.kill('SIGTERM')
  const done = await Promise.race([exited.then(() => true), sleep(15000).then(() => false)])
  if (!done) {
    child.kill('SIGKILL')
    await exited
  }
}

async function teardown() {
  await stopApp()
  for (const name of [...containers]) removeContainer(name)
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.clear()
}

let tearingDown = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (tearingDown) return
    tearingDown = true
    log(`${signal}: tearing down`)
    await teardown()
    process.exit(130)
  })
}

// ---------------------------------------------------------------- infrastructure

async function waitFor(what, fn, timeoutMs = 120000, everyMs = 200) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(everyMs)
  }
}

async function wmFetch(path, init = {}) {
  return fetch(`${WM}${path}`, { ...init, headers: { Authorization: WM_AUTH, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(600000) })
}

async function wmStubCount() {
  const res = await wmFetch('/__admin/mappings?limit=1')
  if (!res.ok) return -1
  return (await res.json()).meta.total
}

async function startWireMock() {
  const name = `wmui-load-wm-${tag}`
  removeContainer(name)
  sh('docker', [
    'run', '-d', '--name', name, '-p', `127.0.0.1:${WM_PORT}:8080`, WIREMOCK_IMAGE,
    '--admin-api-basic-auth', `${WM_USER}:${WM_PASSWORD}`, '--max-request-journal-entries', '5000',
  ])
  containers.add(name)
  await waitFor('WireMock', async () => (await wmFetch('/__admin/version')).ok)
  return name
}

async function startRedis() {
  const name = `wmui-load-redis-${tag}`
  removeContainer(name)
  sh('docker', ['run', '-d', '--name', name, '-p', `127.0.0.1:${REDIS_PORT}:6379`, REDIS_IMAGE])
  containers.add(name)
  await waitFor('Redis', async () => sh('docker', ['exec', name, 'redis-cli', 'ping']) === 'PONG')
  return name
}

function startApp(env) {
  const nodeArgs = ['--experimental-sqlite', '--disable-warning=ExperimentalWarning']
  if (opts['cpu-prof']) {
    // --cpu-prof writes on a normal exit; make SIGTERM one.
    nodeArgs.push('--cpu-prof', `--cpu-prof-dir=${resolve(opts['cpu-prof'])}`, '--import', 'data:text/javascript,process.on("SIGTERM",()=>process.exit(0))')
  }
  const child = spawn(process.execPath, [...nodeArgs, 'server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  const keep = (d) => {
    logs.push(...String(d).split('\n').filter(Boolean))
    if (logs.length > 200) logs.splice(0, logs.length - 200)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  app = { child, logs }
  return app
}

/** Waits until /healthz answers 200 and (with a store) reports a finished sync. */
async function waitHealthy(driver, timeoutMs = 900000) {
  return waitFor(
    'the app to report a sync',
    async () => {
      if (app?.child.exitCode !== null) throw Object.assign(new Error(`app exited: ${app?.logs.slice(-10).join('\n')}`), { fatal: true })
      const res = await fetch(`${APP}/healthz`, { signal: AbortSignal.timeout(5000) })
      if (res.status !== 200) return false
      const body = await res.json()
      return driver === 'none' || body.lastSyncAt !== null
    },
    timeoutMs,
    100,
  ).catch((err) => {
    throw new Error(`${err.message}\n${app?.logs.slice(-15).join('\n') ?? ''}`)
  })
}

function rssMb(pid) {
  try {
    return Number(sh('ps', ['-o', 'rss=', '-p', String(pid)])) / 1024
  } catch {
    return NaN
  }
}

function dockerMem(name) {
  try {
    return sh('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', name]).split('/')[0].trim()
  } catch {
    return '?'
  }
}

// ---------------------------------------------------------------- API client

let session = null

async function login() {
  const res = await fetch(`${APP}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  })
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`)
  const { csrfToken } = await res.json()
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  session = { Cookie: cookie, 'X-CSRF-Token': csrfToken }
}

/** One API call: { status, ms, bytes, body }. Throws on a non-2xx answer. */
async function api(method, path, body) {
  const started = performance.now()
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: { ...session, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(900000),
  })
  const text = await res.text()
  const ms = performance.now() - started
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`)
  return { status: res.status, ms, bytes: Buffer.byteLength(text), body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
function stats(samples) {
  const s = [...samples].sort((a, b) => a - b)
  return { p50: pct(s, 0.5), p95: pct(s, 0.95), max: s[s.length - 1], n: s.length }
}

/** One warm-up, then RUNS timed calls of `fn` (which returns { ms, bytes? }). */
async function bench(fn, runs = RUNS) {
  await fn(-1)
  const samples = []
  let bytes = 0
  for (let i = 0; i < runs; i++) {
    const r = await fn(i)
    samples.push(r.ms)
    bytes = r.bytes ?? bytes
  }
  return { ...stats(samples), bytes }
}

async function pool(jobs, concurrency) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]()
    }),
  )
}

// ---------------------------------------------------------------- seed data

const pad = (n, w = 4) => String(n).padStart(w, '0')

const ENDPOINTS = [
  { key: 'customer', name: 'Get customer', method: 'GET', path: '/customers', pathType: 'exact', lookup: { location: 'query', expression: 'customerId' } },
  { key: 'order', name: 'Get order', method: 'GET', path: '/orders/{orderId}', pathType: 'template', lookup: { location: 'path', expression: 'orderId' } },
  { key: 'account', name: 'Look up account', method: 'POST', path: '/accounts/lookup', pathType: 'exact', lookup: { location: 'jsonPath', expression: '$.accountNumber' } },
  { key: 'profile', name: 'Get profile', method: 'GET', path: '/profile', pathType: 'exact', lookup: { location: 'header', expression: 'X-User-Id' } },
  { key: 'invoice', name: 'List invoices', method: 'GET', path: '/invoices', pathType: 'exact', lookup: { location: 'query', expression: 'invoiceNo' } },
  { key: 'payment', name: 'Payment status', method: 'POST', path: '/payments/status', pathType: 'exact', lookup: { location: 'jsonPath', expression: '$.paymentId' } },
]

function smallBody(key, i, m) {
  return {
    id: key,
    status: m % 3 === 0 ? 'ACTIVE' : 'PENDING',
    name: `Customer ${i}-${m}`,
    email: `user${i}.${m}@example.com`,
    createdAt: '2026-01-15T10:20:30Z',
    balance: { amount: (m * 13.37).toFixed(2), currency: 'SAR' },
    tags: ['load', `sys-${i}`, `m-${m}`],
    address: { line1: `${m} King Road`, city: 'Riyadh', country: 'SA' },
  }
}

function largeBody(key, i) {
  return {
    id: key,
    items: Array.from({ length: 250 }, (_, n) => ({
      sku: `SKU-${i}-${n}`,
      title: `Product number ${n} of the large catalog response`,
      price: { amount: (n * 7.5).toFixed(2), currency: 'SAR' },
      stock: n % 17,
      attributes: { color: ['red', 'green', 'blue'][n % 3], size: ['S', 'M', 'L', 'XL'][n % 4], weightKg: n / 10 },
    })),
  }
}

/** Builds the request matching one response of a mock with several responses (for traffic) and the stub's request pattern. */
function keyedRequest(prefix, ep, key) {
  const traffic = { method: ep.method, path: `${prefix}${ep.path}`, query: '', headers: {}, body: undefined }
  const request = { method: ep.method }
  const match = { equalTo: key }
  const { location, expression } = ep.lookup
  if (ep.pathType === 'template') {
    request.urlPathTemplate = `${prefix}${ep.path}`
    request.pathParameters = { [expression]: match }
    traffic.path = `${prefix}${ep.path.replace(`{${expression}}`, key)}`
  } else {
    request.urlPath = `${prefix}${ep.path}`
  }
  if (location === 'query') {
    request.queryParameters = { [expression]: match }
    traffic.query = `?${expression}=${encodeURIComponent(key)}`
  } else if (location === 'header') {
    request.headers = { [expression]: match }
    traffic.headers[expression] = key
  } else if (location === 'jsonPath') {
    request.bodyPatterns = [{ matchesJsonPath: { expression, ...match } }]
    traffic.body = JSON.stringify({ [expression.slice(2)]: key })
    traffic.headers['Content-Type'] = 'application/json'
  }
  return { request, traffic }
}

/**
 * N mocks (stubs) in ceil(N/100) systems, each system a tag. Per 100: one 3-step scenario, 10 URL mocks, and 87
 * stubs that are the responses of 6 mocks with several responses (one per entry in ENDPOINTS, chosen by a query,
 * path, JSONPath or header value), two of them with large JSON bodies (~45 KB). 1 in 20 is owned by the admin
 * account, the rest are baseline (as an import makes them).
 */
function generate(n) {
  const mocks = []
  const tags = new Set()
  const groups = new Set()
  const traffic = []
  const count = Math.ceil(n / 100)
  for (let i = 1; i <= count; i++) {
    const key = `sys-${pad(i)}`
    const prefix = `/${key}`
    tags.add(key)
    const order = new Map() // group id → next response's place
    /** metadata.wiremockUi for a response of this system's `ep` mock answering `value`. */
    const grouped = (ep, value, owner) => {
      const id = `${key}-${ep.key}`
      groups.add(id)
      const o = order.get(id) ?? 0
      order.set(id, o + 1)
      return { tags: [key], group: { id, by: ep.lookup, value, order: o }, ...owner }
    }
    const here = Math.min(100, n - (i - 1) * 100)
    for (let m = 0; m < here; m++) {
      const id = randomUUID()
      const owner = m % 20 === 7 ? { owner: ADMIN_USER } : {}
      const json = { 'Content-Type': 'application/json' }
      if (m < 3) {
        const states = ['Started', 'pending', 'confirmed']
        mocks.push({
          id,
          name: `${key} checkout step ${m + 1}`,
          request: { method: 'POST', urlPath: `${prefix}/cart/checkout` },
          response: { status: 200, jsonBody: { step: m + 1, state: states[m] }, headers: json },
          scenarioName: `${key}-checkout`,
          requiredScenarioState: states[m],
          ...(m < 2 ? { newScenarioState: states[m + 1] } : {}),
          metadata: { wiremockUi: { tags: [key], ...owner } },
        })
        continue
      }
      if (m < 5) {
        const ep = ENDPOINTS[0]
        const k = `big-${i}-${m}`
        const { request, traffic: t } = keyedRequest(prefix, ep, k)
        mocks.push({ id, name: `${key} ${ep.name.toLowerCase()}`, request, response: { status: 200, jsonBody: largeBody(k, i), headers: json }, metadata: { wiremockUi: grouped(ep, k, owner) } })
        traffic.push(t)
        continue
      }
      if (m < 15) {
        const path = `${prefix}/static/page-${m}`
        mocks.push({
          id,
          name: `${key} page ${m}`,
          request: { method: 'GET', url: `${path}?lang=en` },
          response: { status: 200, body: `<html><body>Page ${m} of ${key}</body></html>`, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          metadata: { wiremockUi: { tags: [key], ...owner } },
        })
        traffic.push({ method: 'GET', path, query: '?lang=en', headers: {}, body: undefined })
        continue
      }
      const ep = ENDPOINTS[m % ENDPOINTS.length]
      const k = `${ep.key}-${i}-${m}`
      const status = m % 10 === 9 ? 404 : 200
      const { request, traffic: t } = keyedRequest(prefix, ep, k)
      mocks.push({
        id,
        name: `${key} ${ep.name.toLowerCase()}`,
        request,
        response: { status, jsonBody: status === 404 ? { error: 'not found', id: k } : smallBody(k, i, m), headers: json },
        metadata: { wiremockUi: grouped(ep, k, owner) },
      })
      traffic.push(t)
    }
  }
  return { tags: [...tags], groups: [...groups], mocks, traffic }
}

/** Bundles of at most MAX_IMPORT_BYTES. */
function chunkBundles(data) {
  const bundles = []
  let current = { mocks: [] }
  let size = 100
  for (const m of data.mocks) {
    const s = Buffer.byteLength(JSON.stringify(m)) + 1
    if (size + s > MAX_IMPORT_BYTES && current.mocks.length > 0) {
      bundles.push(current)
      current = { mocks: [] }
      size = 100
    }
    current.mocks.push(m)
    size += s
  }
  bundles.push(current)
  return bundles
}

// ---------------------------------------------------------------- WireMock traffic

async function sendTraffic(t) {
  const started = performance.now()
  const res = await fetch(`${WM}${t.path}${t.query}`, { method: t.method, headers: t.headers, body: t.body })
  await res.arrayBuffer()
  return { ms: performance.now() - started, status: res.status }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

function unmatchedTraffic(n) {
  const i = 1 + Math.floor(Math.random() * Math.ceil(n / 100))
  const prefix = `/sys-${pad(i)}`
  return pick([
    { method: 'GET', path: `${prefix}/customers`, query: `?customerId=nobody-${Math.random()}`, headers: {}, body: undefined },
    { method: 'POST', path: `${prefix}/accounts/lookup`, query: '', headers: { 'Content-Type': 'application/json' }, body: '{"accountNumber":"none"}' },
    { method: 'GET', path: `/unknown/${Math.random()}`, query: '', headers: {}, body: undefined },
  ])
}

// ---------------------------------------------------------------- one run

async function runOne(driver, size, { serve = false } = {}) {
  const result = { driver, size, notes: [] }
  const dir = mkdtempSync(join(tmpdir(), 'wmui-load-'))
  tempDirs.add(dir)
  log(`== ${driver} / ${size}: starting WireMock${driver === 'redis' ? ' and Redis' : ''}`)
  const wmName = await startWireMock()
  if (driver === 'redis') await startRedis()
  const env = {
    PORT: String(APP_PORT),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    WIREMOCK_URL: WM,
    WIREMOCK_ADMIN_USER: WM_USER,
    WIREMOCK_ADMIN_PASSWORD: WM_PASSWORD,
    STORE_DRIVER: driver,
    SQLITE_PATH: join(dir, 'wiremock-ui.db'),
    REDIS_URL: driver === 'redis' ? `redis://127.0.0.1:${REDIS_PORT}` : '',
    ADMIN_USER,
    ADMIN_PASSWORD,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    BOOT_TIMEOUT_SECONDS: '600',
    SEED_PATH: '',
  }
  startApp(env)
  await waitHealthy(driver)
  await login()

  let peakRss = 0
  const sampler = setInterval(() => {
    if (app) peakRss = Math.max(peakRss, rssMb(app.child.pid) || 0)
  }, 500)
  try {
    // 1. Seed.
    const data = generate(size)
    log(`seeding ${data.mocks.length} stubs: ${data.groups.length} mocks with several responses, ${data.tags.length} tags`)
    const t0 = performance.now()
    if (driver === 'none') {
      // WireMock-only mode: the stubs (tags and groups in their metadata) straight into WireMock.
      for (let i = 0; i < data.mocks.length; i += 1000) {
        const res = await wmFetch('/__admin/mappings/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mappings: data.mocks.slice(i, i + 1000), importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: false } }),
        })
        if (!res.ok) throw new Error(`WireMock import failed: ${res.status}`)
      }
    } else {
      const bundles = chunkBundles(data)
      for (const [n, b] of bundles.entries()) {
        const r = await api('POST', '/api/import', b)
        log(`  import ${n + 1}/${bundles.length}: ${b.mocks.length} mocks in ${(r.ms / 1000).toFixed(1)} s`)
      }
      result.importCalls = bundles.length
    }
    result.importS = (performance.now() - t0) / 1000
    result.seedBytes = Buffer.byteLength(JSON.stringify(data.mocks))
    const wmCount = await wmStubCount()
    const page = (await api('GET', '/api/mocks?limit=1')).body
    if (page.totalMocks !== size) result.notes.push(`store has ${page.totalMocks} mocks, expected ${size}`)
    if (wmCount < size) result.notes.push(`WireMock has ${wmCount} stubs, expected ${size}+`)
    log(`seeded in ${result.importS.toFixed(1)} s (WireMock holds ${wmCount})`)

    if (serve) {
      log(`serving ${APP} (sign in as ${ADMIN_USER} with LOAD_TEST_PASSWORD); Ctrl+C to stop`)
      clearInterval(sampler)
      await new Promise(() => {})
    }

    // 2a. Cold boot: restart the app against the filled store and WireMock.
    await stopApp()
    const tBoot = performance.now()
    startApp(env)
    await waitHealthy(driver)
    result.coldBootS = (performance.now() - tBoot) / 1000
    await login()
    log(`cold boot ${result.coldBootS.toFixed(1)} s`)

    // 2b. WireMock restart: it comes back empty; the reconciler notices the missing marker and re-syncs.
    if (driver !== 'none') {
      const tRestart = performance.now()
      sh('docker', ['restart', '-t', '0', wmName])
      await waitFor('WireMock after restart', async () => (await wmFetch('/__admin/version')).ok, 120000, 100)
      result.wmUpS = (performance.now() - tRestart) / 1000
      await waitFor(
        'the re-sync after a WireMock restart',
        async () => (await wmFetch(`/__admin/mappings/${MARKER_ID}`)).ok && (await wmStubCount()) >= size + 1,
        900000,
        250,
      )
      result.resyncS = (performance.now() - tRestart) / 1000
      log(`WireMock restart: up after ${result.wmUpS.toFixed(1)} s, all stubs back after ${result.resyncS.toFixed(1)} s`)
    }

    // 3. API latency.
    const lat = (result.api = {})
    const first = (await api('GET', '/api/mocks?limit=50')).body
    const lastOffset = Math.max(0, first.total - 50)
    lat.list50 = await bench(() => api('GET', '/api/mocks?limit=50'))
    lat.listEnd = await bench(() => api('GET', `/api/mocks?limit=50&offset=${lastOffset}`))
    const needle = pick(data.mocks.filter((m) => / page \d+$/.test(m.name ?? ''))).name // one mock: "sys-0042 page 7"
    lat.search = await bench(() => api('GET', `/api/mocks?limit=50&q=${encodeURIComponent(needle)}`))
    lat.tag = await bench(() => api('GET', `/api/mocks?limit=50&tag=sys-${pad(Math.ceil(size / 200))}`))
    lat.listAll = await bench(() => api('GET', '/api/mocks'))
    lat.scenarios = await bench(() => api('GET', '/api/scenarios'))
    lat.tags = await bench(() => api('GET', '/api/tags'))
    lat.group = await bench(() => api('GET', '/api/mock-groups/sys-0001-customer'))
    lat.export = await bench(() => api('GET', '/api/export?format=bundle'), Math.min(RUNS, 10))
    const created = []
    lat.create = await bench(async (i) => {
      const r = await api('POST', '/api/mocks', {
        name: `load save ${i}`,
        request: { method: 'GET', urlPath: `/sys-0001/saved/${i + 1}-${randomUUID()}` },
        response: { status: 200, jsonBody: { ok: true } },
        metadata: { wiremockUi: { tags: ['sys-0001'] } },
      })
      created.push(r.body)
      return r
    })
    let target = created[0]
    lat.update = await bench(async (i) => {
      const { id, metadata, ...rest } = target
      const r = await api('PUT', `/api/mocks/${id}`, { stub: { ...rest, name: `load save edited ${i}`, metadata }, version: metadata.wiremockUi.version })
      target = r.body
      return r
    })

    // 4. WireMock answers, then fill the request log to 2,000 and read it back.
    const matched = []
    for (let i = 0; i < WM_REQUESTS; i++) {
      const r = await sendTraffic(pick(data.traffic))
      if (r.status >= 500) result.notes.push(`traffic got ${r.status}`)
      matched.push(r.ms)
    }
    const unmatched = []
    for (let i = 0; i < Math.ceil(WM_REQUESTS / 4); i++) unmatched.push((await sendTraffic(unmatchedTraffic(size))).ms)
    result.wm = { matched: stats(matched), unmatched: stats(unmatched) }
    await pool(
      Array.from({ length: Math.max(0, 2000 - WM_REQUESTS - Math.ceil(WM_REQUESTS / 4)) }, (_, i) => () => sendTraffic(i % 10 === 0 ? unmatchedTraffic(size) : pick(data.traffic))),
      16,
    )
    lat.requests500 = await bench(() => api('GET', '/api/requests?limit=500'))
    lat.unmatchedCount = await bench(() => api('GET', '/api/requests/unmatched-count?minutes=15'))

    // 5. Memory.
    result.appRssMb = rssMb(app.child.pid)
    result.appPeakRssMb = Math.max(peakRss, result.appRssMb)
    result.wmMem = dockerMem(wmName)
    log(`done: app RSS ${result.appRssMb.toFixed(0)} MB (peak ${result.appPeakRssMb.toFixed(0)}), WireMock ${result.wmMem}`)
  } catch (err) {
    result.error = err.message
    log(`FAILED: ${err.message}`)
  } finally {
    clearInterval(sampler)
    await teardown()
  }
  return result
}

// ---------------------------------------------------------------- report

const ms = (s) => (s ? `${Math.round(s.p50)} / ${Math.round(s.p95)}` : '–')
const sec = (v) => (v === undefined ? '–' : `${v.toFixed(1)} s`)

function table(results) {
  const cols = results.map((r) => `${r.driver} ${r.size.toLocaleString('en')}`)
  const rows = [
    ['Import (seed)', (r) => sec(r.importS)],
    ['Cold boot to first sync', (r) => sec(r.coldBootS)],
    ['WireMock restart → all stubs back', (r) => (r.driver === 'none' ? 'n/a' : sec(r.resyncS))],
    ['GET /api/mocks?limit=50 (p50 / p95 ms)', (r) => ms(r.api?.list50)],
    ['… offset near the end', (r) => ms(r.api?.listEnd)],
    ['… q= search', (r) => ms(r.api?.search)],
    ['… tag filter', (r) => ms(r.api?.tag)],
    ['GET /api/mocks (no limit)', (r) => ms(r.api?.listAll)],
    ['GET /api/scenarios', (r) => ms(r.api?.scenarios)],
    ['GET /api/tags', (r) => ms(r.api?.tags)],
    ['GET /api/mock-groups/:id (16 responses)', (r) => ms(r.api?.group)],
    ['GET /api/export?format=bundle', (r) => ms(r.api?.export)],
    ['… export size', (r) => (r.api?.export ? `${(r.api.export.bytes / 1024 / 1024).toFixed(1)} MB` : '–')],
    ['POST /api/mocks (save new)', (r) => ms(r.api?.create)],
    ['PUT /api/mocks/:id (save edit)', (r) => ms(r.api?.update)],
    ['GET /api/requests?limit=500', (r) => ms(r.api?.requests500)],
    ['GET /api/requests/unmatched-count', (r) => ms(r.api?.unmatchedCount)],
    ['WireMock matched request', (r) => ms(r.wm?.matched)],
    ['WireMock unmatched request', (r) => ms(r.wm?.unmatched)],
    ['App RSS (end / peak MB)', (r) => (r.appRssMb ? `${r.appRssMb.toFixed(0)} / ${r.appPeakRssMb.toFixed(0)}` : '–')],
    ['WireMock memory', (r) => r.wmMem ?? '–'],
  ]
  const out = [`| Metric | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`]
  for (const [label, f] of rows) out.push(`| ${label} | ${results.map(f).join(' | ')} |`)
  const problems = results.filter((r) => r.error || r.notes.length)
  for (const r of problems) out.push('', `- ${r.driver} ${r.size}: ${[r.error, ...r.notes].filter(Boolean).join('; ')}`)
  return out.join('\n')
}

// ---------------------------------------------------------------- main

if (!opts['no-build']) {
  log('building (npm run build)')
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}

const results = []
try {
  if (opts.serve) {
    await runOne(DRIVERS[0], SIZES[0], { serve: true })
  } else {
    for (const driver of DRIVERS) {
      for (const size of SIZES) {
        if (driver === 'none' && size > NONE_MAX) continue
        results.push(await runOne(driver, size))
        if (opts.json) writeFileSync(opts.json, JSON.stringify(results, null, 2))
      }
    }
  }
} finally {
  await teardown()
}

console.log(`\n${table(results)}\n`)
console.log(`Measured with ${RUNS} runs per API call (one warm-up first), ${WM_REQUESTS} WireMock requests, WireMock ${WIREMOCK_IMAGE.split(':')[1]}, node ${process.version}.`)
