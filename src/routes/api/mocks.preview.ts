import { createFileRoute } from '@tanstack/react-router'
import { previewQuickMock } from '../../server/http/handlers/catalog'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/mocks/preview')({
  server: {
    handlers: {
      POST: async ({ request, params }) => previewQuickMock(await getRuntime(), request, params),
    },
  },
})
