import { createFileRoute } from '@tanstack/react-router'
import { mockHistory } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mocks/$id/history')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => mockHistory(await getRuntime(), request, params),
    },
  },
})
