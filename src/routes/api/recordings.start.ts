import { createFileRoute } from '@tanstack/react-router'
import { startRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings/start')({
  server: {
    handlers: {
      POST: async ({ request }) => startRecording(await getRuntime(), request),
    },
  },
})
