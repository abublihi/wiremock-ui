import { ConfigError } from '../errors'
import type { WireMockClient } from './client'

export async function assertWireMockReady(
  client: WireMockClient,
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const open = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/__admin/mappings?limit=1`)
  if (open.status === 200) {
    throw new ConfigError('WireMock admin API answers without auth; start WireMock with --admin-api-basic-auth')
  }
  const version = await client.version().catch(() => null)
  if (version === null) throw new ConfigError('WireMock admin credentials rejected')
  const major = Number.parseInt(version, 10)
  if (!(major >= 3)) throw new ConfigError(`WireMock 3.x is required, found ${version}`)
  if (!(await client.ping())) throw new ConfigError('WireMock admin credentials rejected')
}
