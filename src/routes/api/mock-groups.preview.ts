import { createFileRoute } from '@tanstack/react-router'
import { previewGroup } from '../../server/http/handlers/groups'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mock-groups/preview')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request, params }) => previewGroup(await getRuntime(), request, params),
    },
  },
})
