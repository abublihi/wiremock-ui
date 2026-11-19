import { createFileRoute } from '@tanstack/react-router'
import { deleteMock, getMock, updateMock } from '../../server/http/handlers'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/mocks/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => getMock(await getRuntime(), request, params),
      PUT: async ({ request, params }) => updateMock(await getRuntime(), request, params),
      DELETE: async ({ request, params }) => deleteMock(await getRuntime(), request, params),
    },
  },
})
