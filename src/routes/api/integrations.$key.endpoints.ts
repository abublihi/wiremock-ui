import { createFileRoute } from '@tanstack/react-router'
import { listEndpoints } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/integrations/$key/endpoints')({
  server: {
    handlers: {
      GET: async ({ request, params }) => listEndpoints(await getRuntime(), request, params),
    },
  },
})
