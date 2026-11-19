import { createFileRoute } from '@tanstack/react-router'
import { listAudit } from '../../server/http/handlers/audit'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/audit')({
  server: {
    handlers: {
      GET: async ({ request }) => listAudit(await getRuntime(), request),
    },
  },
})
