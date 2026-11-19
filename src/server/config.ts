import { z } from 'zod'
import { ConfigError } from './errors'

export type Config = {
  wiremockUrl: string
  wiremockAdminUser?: string
  wiremockAdminPassword?: string
  storeDriver: 'redis'
  redisUrl: string
  adminUser: string
  adminPassword: string
  sessionSecret: string
  syncIntervalSeconds: number
}

const required = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`)

const schema = z.object({
  WIREMOCK_URL: z.string().min(1).default('http://localhost:8080'),
  WIREMOCK_ADMIN_USER: z.string().min(1).optional(),
  WIREMOCK_ADMIN_PASSWORD: z.string().min(1).optional(),
  STORE_DRIVER: z.string().default('redis'),
  REDIS_URL: z.string().min(1).optional(),
  ADMIN_USER: required('ADMIN_USER'),
  ADMIN_PASSWORD: required('ADMIN_PASSWORD'),
  SESSION_SECRET: required('SESSION_SECRET'),
  SYNC_INTERVAL_SECONDS: z.coerce
    .number({ error: 'SYNC_INTERVAL_SECONDS must be a positive number' })
    .positive('SYNC_INTERVAL_SECONDS must be a positive number')
    .default(5),
})

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Treat empty strings as unset so `FOO=` in an env file behaves like absent.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''))
  const parsed = schema.safeParse(cleaned)
  const problems: string[] = []
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(issue.message.startsWith(String(issue.path[0])) ? issue.message : `${String(issue.path[0])}: ${issue.message}`)
  }
  const data = parsed.success ? parsed.data : undefined

  if (cleaned.STORE_DRIVER === 'sqlite') {
    problems.push('STORE_DRIVER=sqlite is not available yet (planned for milestone 5)')
  } else if (cleaned.STORE_DRIVER !== undefined && cleaned.STORE_DRIVER !== 'redis') {
    problems.push(`STORE_DRIVER must be "redis", got "${cleaned.STORE_DRIVER}"`)
  } else if (!cleaned.REDIS_URL) {
    problems.push('REDIS_URL is required when STORE_DRIVER=redis')
  }

  if (problems.length > 0 || !data) {
    throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`)
  }

  return {
    wiremockUrl: data.WIREMOCK_URL,
    wiremockAdminUser: data.WIREMOCK_ADMIN_USER,
    wiremockAdminPassword: data.WIREMOCK_ADMIN_PASSWORD,
    storeDriver: 'redis',
    redisUrl: data.REDIS_URL as string,
    adminUser: data.ADMIN_USER,
    adminPassword: data.ADMIN_PASSWORD,
    sessionSecret: data.SESSION_SECRET,
    syncIntervalSeconds: data.SYNC_INTERVAL_SECONDS,
  }
}
