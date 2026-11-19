import { ConfigError, UpstreamError } from '../errors'
import type { WireMockClient } from './client'

export async function assertWireMockReady(
  client: WireMockClient,
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const root = baseUrl.replace(/\/+$/, '')
  let open: Response
  try {
    open = await fetchFn(`${root}/__admin/mappings?limit=1`)
  } catch (err) {
    throw new UpstreamError(`WireMock unreachable at ${baseUrl}: ${(err as Error).message}`)
  }
  if (open.status === 200) {
    throw new ConfigError('WireMock admin API answers without auth; start WireMock with --admin-api-basic-auth')
  }
  // version() throws ConfigError on 401/403 and UpstreamError on 5xx/network.
  const version = await client.version()
  const major = Number.parseInt(version, 10)
  if (!(major >= 3)) throw new ConfigError(`WireMock 3.x is required, found ${version}`)
  if (!(await client.ping())) throw new ConfigError('WireMock admin credentials rejected')
}
