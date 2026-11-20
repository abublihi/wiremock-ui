import { createFileRoute } from '@tanstack/react-router'
import { recordingStatus } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings/status')({
  server: {
    handlers: {
      GET: async ({ request }) => recordingStatus(await getRuntime(), request),
    },
  },
})
