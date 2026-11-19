import { createFileRoute } from '@tanstack/react-router'
import { restoreMock } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/mocks/$id/restore')({
  server: {
    handlers: {
      POST: async ({ request, params }) => restoreMock(await getRuntime(), request, params),
    },
  },
})
