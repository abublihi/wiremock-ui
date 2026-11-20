import { json, withAuth } from '../wrap'

/** What the UI needs to know about how this server runs. An object, so later settings can join it. */
export type PublicConfig = {
  storeDriver: 'redis' | 'sqlite' | 'none'
  /** WireMock's stub port as clients reach it (WIREMOCK_PUBLIC_URL, default WIREMOCK_URL): for curl commands. */
  wiremockPublicUrl: string
  /** RECORDING_ALLOWED: false hides the Recording page and the request log's "Create mocks" action. */
  recordingAllowed: boolean
}

export const getConfig = withAuth(null, async ({ rt }) => {
  const body: PublicConfig = { storeDriver: rt.config.storeDriver, wiremockPublicUrl: rt.config.wiremockPublicUrl, recordingAllowed: rt.config.recordingAllowed }
  return json(body)
})
