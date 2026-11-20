import { createFileRoute } from '@tanstack/react-router'
import { sendTestRequest } from '../../server/http/handlers/test'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/test-request')({
  server: {
    handlers: {
      POST: async ({ request }) => sendTestRequest(await getRuntime(), request),
    },
  },
})
