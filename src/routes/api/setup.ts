import { createFileRoute } from '@tanstack/react-router'
import { getSetup } from '../../server/http/handlers/setup'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/setup')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => getSetup(await getRuntime(), request),
      HEAD: async ({ request }) => headOf(getSetup(await getRuntime(), request)),
    },
  },
})
