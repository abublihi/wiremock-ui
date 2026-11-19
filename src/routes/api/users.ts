import { createFileRoute } from '@tanstack/react-router'
import { createUser, listUsers } from '../../server/http/handlers/users'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/users')({
  server: {
    handlers: {
      GET: async ({ request }) => listUsers(await getRuntime(), request),
      POST: async ({ request }) => createUser(await getRuntime(), request),
    },
  },
})
