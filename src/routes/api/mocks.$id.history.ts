import { createFileRoute } from '@tanstack/react-router'
import { mockHistory } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/mocks/$id/history')({
  server: {
    handlers: {
      GET: async ({ request, params }) => mockHistory(await getRuntime(), request, params),
    },
  },
})
