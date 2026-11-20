import { json, withAuth } from '../wrap'

/** What the UI needs to know about how this server runs. An object, so later settings can join it. */
export type PublicConfig = {
  storeDriver: 'redis' | 'sqlite' | 'none'
  /** WireMock's stub port as clients reach it (WIREMOCK_PUBLIC_URL, default WIREMOCK_URL): for curl commands. */
  wiremockPublicUrl: string
}

export const getConfig = withAuth(null, async ({ rt }) => {
  const body: PublicConfig = { storeDriver: rt.config.storeDriver, wiremockPublicUrl: rt.config.wiremockPublicUrl }
  return json(body)
})
