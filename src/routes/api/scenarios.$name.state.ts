import { createFileRoute } from '@tanstack/react-router'
import { setScenarioState } from '../../server/http/handlers/scenarios'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/scenarios/$name/state')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      PUT: async ({ request, params }) => setScenarioState(await getRuntime(), request, params),
    },
  },
})
