import { createFileRoute } from '@tanstack/react-router'
import { createCatalogMock } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/integrations/$key/endpoints/$endpoint/mocks')({
  server: {
    handlers: {
      POST: async ({ request, params }) => createCatalogMock(await getRuntime(), request, params),
    },
  },
})
