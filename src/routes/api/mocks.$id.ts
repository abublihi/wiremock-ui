import { createFileRoute } from '@tanstack/react-router'
import { deleteMock, getMock, updateMock } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mocks/$id')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request, params }) => getMock(await getRuntime(), request, params),
      PUT: async ({ request, params }) => updateMock(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteMock(await getRuntime(), request, params),
    },
  },
})
