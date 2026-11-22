import { FIRST_ADMIN_COMMAND } from '../../runtime'
import { json, withErrors } from '../wrap'

/**
 * Whether this server still needs its first account (no accounts, ADMIN_USER / ADMIN_PASSWORD not set). Public: the
 * sign-in page shows the command that creates it. Says nothing else, and the account can only be made from a shell
 * on the server (`wiremock-ui create-admin`), never over HTTP.
 */
export type SetupStatus = { needsFirstAdmin: boolean; command: string }

export const getSetup = withErrors(async (rt) => {
  const body: SetupStatus = { needsFirstAdmin: (await rt.stores.users.countUsers()) === 0, command: FIRST_ADMIN_COMMAND }
  return json(body, 200, { 'Cache-Control': 'no-store' })
})
