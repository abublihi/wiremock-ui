import { createFileRoute } from '@tanstack/react-router'
import { acceptRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings/$id/accept')({
  server: {
    handlers: {
      POST: async ({ request, params }) => acceptRecording(await getRuntime(), request, params),
    },
  },
})
