import { createFileRoute } from '@tanstack/react-router'
import { recordingStatus } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings/status')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => recordingStatus(await getRuntime(), request),
      HEAD: async ({ request }) => headOf(recordingStatus(await getRuntime(), request)),
    },
  },
})
