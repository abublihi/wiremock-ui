import { createFileRoute } from '@tanstack/react-router'
import { createGroup } from '../../server/http/handlers/groups'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mock-groups')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => createGroup(await getRuntime(), request),
    },
  },
})
