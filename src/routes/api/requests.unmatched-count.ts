import { createFileRoute } from '@tanstack/react-router'
import { recentUnmatchedCount } from '../../server/http/handlers/requests'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/requests/unmatched-count')({
  server: {
    handlers: {
      GET: async ({ request }) => recentUnmatchedCount(await getRuntime(), request),
    },
  },
})
