import { createFileRoute } from '@tanstack/react-router'
import { recentUnmatchedCount } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/requests/unmatched-count')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => recentUnmatchedCount(await getRuntime(), request),
    },
  },
})
