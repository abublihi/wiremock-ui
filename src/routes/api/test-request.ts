import { createFileRoute } from '@tanstack/react-router'
import { sendTestRequest } from '../../server/http/handlers/test'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/test-request')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => sendTestRequest(await getRuntime(), request),
    },
  },
})
