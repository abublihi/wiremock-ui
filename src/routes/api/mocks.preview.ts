import { createFileRoute } from '@tanstack/react-router'
import { previewQuickMock } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mocks/preview')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request, params }) => previewQuickMock(await getRuntime(), request, params),
    },
  },
})
