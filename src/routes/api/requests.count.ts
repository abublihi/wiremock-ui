import { createFileRoute } from '@tanstack/react-router'
import { countRequests } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/requests/count')({
  server: {
    handlers: {
      POST: async ({ request }) => countRequests(await getRuntime(), request),
    },
  },
})
