import { createFileRoute } from '@tanstack/react-router'
import { createMock, listMocks } from '../../server/http/handlers'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/mocks')({
  server: {
    handlers: {
      GET: async ({ request }) => listMocks(await getRuntime(), request),
      POST: async ({ request }) => createMock(await getRuntime(), request),
    },
  },
})
