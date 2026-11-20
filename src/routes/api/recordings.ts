import { createFileRoute } from '@tanstack/react-router'
import { listRecordings } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listRecordings(await getRuntime(), request),
      HEAD: async ({ request }) => headOf(listRecordings(await getRuntime(), request)),
    },
  },
})
