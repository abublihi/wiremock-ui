import { createFileRoute } from '@tanstack/react-router'
import { setScenarioState } from '../../server/http/handlers/scenarios'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/scenarios/$name/state')({
  server: {
    handlers: {
      PUT: async ({ request, params }) => setScenarioState(await getRuntime(), request, params),
    },
  },
})
