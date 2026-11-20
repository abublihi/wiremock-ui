import { createFileRoute } from '@tanstack/react-router'
import { listScenarios } from '../../server/http/handlers/scenarios'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/scenarios')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listScenarios(await getRuntime(), request),
      HEAD: async ({ request }) => headOf(listScenarios(await getRuntime(), request)),
    },
  },
})
