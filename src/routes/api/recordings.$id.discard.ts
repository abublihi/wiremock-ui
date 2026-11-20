import { createFileRoute } from '@tanstack/react-router'
import { discardRecordingItems } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings/$id/discard')({
  server: {
    handlers: {
      POST: async ({ request, params }) => discardRecordingItems(await getRuntime(), request, params),
    },
  },
})
