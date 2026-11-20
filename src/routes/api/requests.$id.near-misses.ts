import { createFileRoute } from '@tanstack/react-router'
import { nearMisses } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/requests/$id/near-misses')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => nearMisses(await getRuntime(), request, params),
    },
  },
})
