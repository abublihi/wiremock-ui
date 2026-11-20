import { createFileRoute } from '@tanstack/react-router'
import { getRecording, deleteRecording } from '../../server/http/handlers/recordings'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/recordings/$id')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => getRecording(await getRuntime(), request, params),
      HEAD: async ({ request, params }) => headOf(getRecording(await getRuntime(), request, params)),
      DELETE: async ({ request, params }) => deleteRecording(await getRuntime(), request, params),
    },
  },
})
