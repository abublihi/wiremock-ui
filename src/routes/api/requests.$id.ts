import { createFileRoute } from '@tanstack/react-router'
import { getRequest } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/requests/$id')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => getRequest(await getRuntime(), request, params),
    },
  },
})
