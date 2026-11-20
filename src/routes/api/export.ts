import { createFileRoute } from '@tanstack/react-router'
import { exportMocks } from '../../server/http/handlers/export'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/export')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => exportMocks(await getRuntime(), request),
    },
  },
})
