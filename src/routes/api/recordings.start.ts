import { createFileRoute } from '@tanstack/react-router'
import { startRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings/start')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => startRecording(await getRuntime(), request),
    },
  },
})
