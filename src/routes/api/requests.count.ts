import { createFileRoute } from '@tanstack/react-router'
import { countRequests } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/requests/count')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => countRequests(await getRuntime(), request),
    },
  },
})
