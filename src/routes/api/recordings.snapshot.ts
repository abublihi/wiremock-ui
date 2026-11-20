import { createFileRoute } from '@tanstack/react-router'
import { snapshotRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings/snapshot')({
  server: {
    handlers: {
      POST: async ({ request }) => snapshotRecording(await getRuntime(), request),
    },
  },
})
