import { createFileRoute } from '@tanstack/react-router'
import { getSession, login, logout } from '../../server/http/handlers/session'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/session')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => login(await getRuntime(), request),
      GET: async ({ request }) => getSession(await getRuntime(), request),
      DELETE: async ({ request }) => logout(await getRuntime(), request),
    },
  },
})
