import { createFileRoute } from '@tanstack/react-router'
import { stopRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings/stop')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => stopRecording(await getRuntime(), request),
    },
  },
})
