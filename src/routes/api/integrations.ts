import { createFileRoute } from '@tanstack/react-router'
import { listIntegrations } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/integrations')({
  server: {
    handlers: {
      GET: async ({ request }) => listIntegrations(await getRuntime(), request),
    },
  },
})
