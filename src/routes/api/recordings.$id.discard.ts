import { createFileRoute } from '@tanstack/react-router'
import { discardRecordingItems } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings/$id/discard')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request, params }) => discardRecordingItems(await getRuntime(), request, params),
    },
  },
})
