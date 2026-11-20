import { createFileRoute } from '@tanstack/react-router'
import { resetScenarios } from '../../server/http/handlers/scenarios'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/scenarios/reset')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => resetScenarios(await getRuntime(), request),
    },
  },
})
