import { createFileRoute } from '@tanstack/react-router'
import { getRecording, deleteRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/recordings/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => getRecording(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteRecording(await getRuntime(), request, params),
    },
  },
})
