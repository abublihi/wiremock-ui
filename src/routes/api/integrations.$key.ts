import { createFileRoute } from '@tanstack/react-router'
import { deleteIntegration, putIntegration } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/integrations/$key')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      PUT: async ({ request, params }) => putIntegration(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteIntegration(await getRuntime(), request, params),
    },
  },
})
