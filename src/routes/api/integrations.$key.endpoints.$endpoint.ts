import { createFileRoute } from '@tanstack/react-router'
import { deleteEndpoint, getEndpoint, putEndpoint } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/integrations/$key/endpoints/$endpoint')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => getEndpoint(await getRuntime(), request, params),
      PUT: async ({ request, params }) => putEndpoint(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteEndpoint(await getRuntime(), request, params),
    },
  },
})
