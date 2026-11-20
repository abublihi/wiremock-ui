import { createFileRoute } from '@tanstack/react-router'
import { resetMine } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mocks/reset-mine')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => resetMine(await getRuntime(), request),
    },
  },
})
