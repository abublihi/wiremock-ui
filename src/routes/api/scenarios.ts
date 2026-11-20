import { createFileRoute } from '@tanstack/react-router'
import { listScenarios } from '../../server/http/handlers/scenarios'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/scenarios')({
  server: {
    handlers: {
      GET: async ({ request }) => listScenarios(await getRuntime(), request),
    },
  },
})
