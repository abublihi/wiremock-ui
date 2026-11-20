import { createFileRoute } from '@tanstack/react-router'
import { runImport } from '../../server/http/handlers/imports'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/import')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request }) => runImport(await getRuntime(), request),
    },
  },
})
