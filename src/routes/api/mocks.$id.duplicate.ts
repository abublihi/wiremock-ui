import { createFileRoute } from '@tanstack/react-router'
import { duplicateMock } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mocks/$id/duplicate')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      POST: async ({ request, params }) => duplicateMock(await getRuntime(), request, params),
    },
  },
})
