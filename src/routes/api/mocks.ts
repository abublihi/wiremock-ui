import { createFileRoute } from '@tanstack/react-router'
import { createMock, listMocks } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'
import { methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/mocks')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listMocks(await getRuntime(), request),
      POST: async ({ request }) => createMock(await getRuntime(), request),
    },
  },
})
