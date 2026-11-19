import { createFileRoute } from '@tanstack/react-router'
import { nearMisses } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/requests/$id/near-misses')({
  server: {
    handlers: {
      GET: async ({ request, params }) => nearMisses(await getRuntime(), request, params),
    },
  },
})
