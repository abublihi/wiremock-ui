import { createFileRoute } from '@tanstack/react-router'
import { deleteGroup, getGroup, updateGroup } from '../../server/http/handlers/groups'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mock-groups/$id')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => getGroup(await getRuntime(), request, params),
      HEAD: async ({ request, params }) => headOf(getGroup(await getRuntime(), request, params)),
      PUT: async ({ request, params }) => updateGroup(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteGroup(await getRuntime(), request, params),
    },
  },
})
