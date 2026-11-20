import { json, withAuth } from '../wrap'

/** What the UI needs to know about how this server runs. An object, so later settings can join it. */
export type PublicConfig = {
  storeDriver: 'redis' | 'sqlite' | 'none'
}

export const getConfig = withAuth(null, async ({ rt }) => {
  const body: PublicConfig = { storeDriver: rt.config.storeDriver }
  return json(body)
})
