import { createFileRoute } from '@tanstack/react-router'
import { getRequest } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/requests/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => getRequest(await getRuntime(), request, params),
    },
  },
})
