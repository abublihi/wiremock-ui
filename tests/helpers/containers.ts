import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

export type WireMockHandle = {
  url: string
  user: string
  password: string
  restart(): Promise<void>
  stop(): Promise<void>
}

const USER = 'admin'
const PASSWORD = 'secret'
const authHeader = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`

export async function startWireMock(opts: { auth?: boolean } = {}): Promise<WireMockHandle> {
  const auth = opts.auth !== false
  let container: StartedTestContainer = await new GenericContainer('wiremock/wiremock:3.13.1')
    .withExposedPorts(8080)
    .withCommand(
      auth
        ? ['--admin-api-basic-auth', `${USER}:${PASSWORD}`, '--max-request-journal-entries', '5000']
        : ['--max-request-journal-entries', '5000'],
    )
    .withWaitStrategy(
      Wait.forHttp('/__admin/health', 8080).withHeaders(auth ? { Authorization: authHeader } : {}),
    )
    .start()
  const url = `http://${container.getHost()}:${container.getMappedPort(8080)}`
  const headers: Record<string, string> = auth ? { Authorization: authHeader } : {}
  return {
    url,
    user: USER,
    password: PASSWORD,
    // Simulates a restart: reset empties mappings and the journal, same port.
    async restart() {
      const res = await fetch(`${url}/__admin/reset`, { method: 'POST', headers })
      if (!res.ok) throw new Error(`WireMock reset failed: ${res.status}`)
    },
    async stop() {
      await container.stop()
    },
  }
}

export async function startRedis(): Promise<{ url: string; stop(): Promise<void> }> {
  const container = await new GenericContainer('redis:7.4-alpine')
    .withExposedPorts(6379)
    .withCommand(['redis-server', '--appendonly', 'yes'])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    stop: async () => {
      await container.stop()
    },
  }
}
