import { createFileRoute } from '@tanstack/react-router'
import { listRecordings } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings')({
  server: {
    handlers: {
      GET: async ({ request }) => listRecordings(await getRuntime(), request),
    },
  },
})
