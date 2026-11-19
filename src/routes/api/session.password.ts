import { createFileRoute } from '@tanstack/react-router'
import { changePassword } from '../../server/http/handlers/session'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/session/password')({
  server: {
    handlers: {
      POST: async ({ request }) => changePassword(await getRuntime(), request),
    },
  },
})
