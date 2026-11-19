import { createFileRoute } from '@tanstack/react-router'
import { resetMine } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/mocks/reset-mine')({
  server: {
    handlers: {
      POST: async ({ request }) => resetMine(await getRuntime(), request),
    },
  },
})
