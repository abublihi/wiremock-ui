import { createFileRoute } from '@tanstack/react-router'
import { getConfig } from '../../server/http/handlers/config'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/config')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => getConfig(await getRuntime(), request),
    },
  },
})
