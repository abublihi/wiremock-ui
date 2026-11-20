import { createFileRoute } from '@tanstack/react-router'
import { snapshotRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings/snapshot')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => snapshotRecording(await getRuntime(), request),
    },
  },
})
