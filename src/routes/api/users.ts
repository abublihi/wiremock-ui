import { createFileRoute } from '@tanstack/react-router'
import { createUser, listUsers } from '../../server/http/handlers/users'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/users')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listUsers(await getRuntime(), request),
      HEAD: async ({ request }) => headOf(listUsers(await getRuntime(), request)),
      POST: async ({ request }) => createUser(await getRuntime(), request),
    },
  },
})
