import { createFileRoute } from '@tanstack/react-router'
import { stopRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings/stop')({
  server: {
    handlers: {
      POST: async ({ request }) => stopRecording(await getRuntime(), request),
    },
  },
})
