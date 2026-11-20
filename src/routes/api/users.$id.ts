import { createFileRoute } from '@tanstack/react-router'
import { deleteUser, updateUser } from '../../server/http/handlers/users'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/users/$id')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      PATCH: async ({ request, params }) => updateUser(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteUser(await getRuntime(), request, params),
    },
  },
})
