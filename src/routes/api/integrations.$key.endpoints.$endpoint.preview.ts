import { createFileRoute } from '@tanstack/react-router'
import { previewMock } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/integrations/$key/endpoints/$endpoint/preview')({
  server: {
    handlers: {
      POST: async ({ request, params }) => previewMock(await getRuntime(), request, params),
    },
  },
})
