import { createFileRoute } from '@tanstack/react-router'
import { createCatalogMock } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/integrations/$key/endpoints/$endpoint/mocks')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request, params }) => createCatalogMock(await getRuntime(), request, params),
    },
  },
})
