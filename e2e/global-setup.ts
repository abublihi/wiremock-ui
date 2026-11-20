import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startWireMock } from '../tests/helpers/containers'
import { ADMIN, E2E_UI_PORT, E2E_UI_URL, USER_A, USER_B } from './env'

const root = resolve(import.meta.dirname, '..')

function assertPortFree(port: number): Promise<void> {
  return new Promise((ok, fail) => {
    const probe = createServer()
    probe.once('error', () => fail(new Error(`Port ${port} is in use; set E2E_UI_PORT to a free port`)))
    probe.listen(port, '127.0.0.1', () => probe.close(() => ok()))
  })
}

async function waitForHealth(app: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`The app exited with ${app.exitCode}:\n${output()}`)
    try {
      const res = await fetch(`${E2E_UI_URL}/healthz`)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`The app did not become healthy within 60 s:\n${output()}`)
}

async function addUser(user: { username: string; password: string }, displayName: string): Promise<void> {
  const res = await fetch(`${E2E_UI_URL}/api/users`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${ADMIN.username}:${ADMIN.password}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...user, displayName }),
  })
  if (!res.ok) throw new Error(`Creating ${user.username} failed: ${res.status} ${await res.text()}`)
}

/** Starts WireMock (admin auth on) and the built app on SQLite with the e2e seed; returns the teardown. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(join(root, 'dist/server/server.js'))) throw new Error('No build found: run `npm run build` (npm run test:e2e does)')
  await assertPortFree(E2E_UI_PORT)

  const wiremock = await startWireMock()
  const dataDir = mkdtempSync(join(tmpdir(), 'wiremock-ui-e2e-'))
  let log = ''
  const app = spawn(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', 'server.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PORT: String(E2E_UI_PORT),
      LOG_LEVEL: 'warn',
      WIREMOCK_URL: wiremock.url,
      WIREMOCK_ADMIN_USER: wiremock.user,
      WIREMOCK_ADMIN_PASSWORD: wiremock.password,
      STORE_DRIVER: 'sqlite',
      SQLITE_PATH: join(dataDir, 'wiremock-ui.db'),
      ADMIN_USER: ADMIN.username,
      ADMIN_PASSWORD: ADMIN.password,
      SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-123',
      SEED_PATH: join(root, 'tests/fixtures/e2e-seed'),
      SYNC_INTERVAL_SECONDS: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  app.stdout?.on('data', (d) => (log += d))
  app.stderr?.on('data', (d) => (log += d))

  const teardown = async () => {
    if (app.exitCode === null) {
      const exited = new Promise((r) => app.once('exit', r))
      app.kill('SIGTERM')
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))])
      if (app.exitCode === null) app.kill('SIGKILL')
    }
    await wiremock.stop()
    rmSync(dataDir, { recursive: true, force: true })
  }

  try {
    await waitForHealth(app, () => log)
    await addUser(USER_A, 'Alice (QA)')
    await addUser(USER_B, 'Bob (QA)')
  } catch (err) {
    await teardown()
    throw err
  }
  process.env.E2E_WIREMOCK_URL = wiremock.url
  return teardown
}
