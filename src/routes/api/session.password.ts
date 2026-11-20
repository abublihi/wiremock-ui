import { createFileRoute } from '@tanstack/react-router'
import { changePassword } from '../../server/http/handlers/session'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/session/password')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => changePassword(await getRuntime(), request),
    },
  },
})
