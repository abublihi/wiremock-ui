import { createFileRoute } from '@tanstack/react-router'
import { exportMocks } from '../../server/http/handlers/export'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/export')({
  server: {
    handlers: {
      GET: async ({ request }) => exportMocks(await getRuntime(), request),
    },
  },
})
