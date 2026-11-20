import { createFileRoute } from '@tanstack/react-router'
import { listAudit } from '../../server/http/handlers/audit'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/audit')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listAudit(await getRuntime(), request),
    },
  },
})
