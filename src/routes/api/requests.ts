import { createFileRoute } from '@tanstack/react-router'
import { clearRequests, listRequests } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/requests')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listRequests(await getRuntime(), request),
      DELETE: async ({ request }) => clearRequests(await getRuntime(), request),
    },
  },
})
