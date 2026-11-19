import { createFileRoute } from '@tanstack/react-router'
import { getSession, login, logout } from '../../server/http/handlers/session'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/session')({
  server: {
    handlers: {
      POST: async ({ request }) => login(await getRuntime(), request),
      GET: async ({ request }) => getSession(await getRuntime(), request),
      DELETE: async ({ request }) => logout(await getRuntime(), request),
    },
  },
})
