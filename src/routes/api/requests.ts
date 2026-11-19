import { createFileRoute } from '@tanstack/react-router'
import { clearRequests, listRequests } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/requests')({
  server: {
    handlers: {
      GET: async ({ request }) => listRequests(await getRuntime(), request),
      DELETE: async ({ request }) => clearRequests(await getRuntime(), request),
    },
  },
})
