import { createFileRoute } from '@tanstack/react-router'
import { listEndpoints } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/integrations/$key/endpoints')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => listEndpoints(await getRuntime(), request, params),
      HEAD: async ({ request, params }) => headOf(listEndpoints(await getRuntime(), request, params)),
    },
  },
})
