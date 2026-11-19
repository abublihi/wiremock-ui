import { createFileRoute } from '@tanstack/react-router'
import { deleteIntegration, putIntegration } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/integrations/$key')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => putIntegration(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteIntegration(await getRuntime(), request, params),
    },
  },
})
