import { createFileRoute } from '@tanstack/react-router'
import { resetScenarios } from '../../server/http/handlers/scenarios'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/scenarios/reset')({
  server: {
    handlers: {
      POST: async ({ request }) => resetScenarios(await getRuntime(), request),
    },
  },
})
