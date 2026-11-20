import { createFileRoute } from '@tanstack/react-router'
import { acceptRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings/$id/accept')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request, params }) => acceptRecording(await getRuntime(), request, params),
    },
  },
})
