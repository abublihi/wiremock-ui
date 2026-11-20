import { createFileRoute } from '@tanstack/react-router'
import { listIntegrations } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/integrations')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listIntegrations(await getRuntime(), request),
    },
  },
})
