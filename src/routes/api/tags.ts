import { createFileRoute } from '@tanstack/react-router'
import { listTags } from '../../server/http/handlers/mocks'
import { getRuntime } from '../../server/runtime'
import { headOf, methodNotAllowed } from '../../server/http/handlers/fallback'

export const Route = createFileRoute('/api/tags')({
  server: {
    handlers: {
      ANY: async ({ request }) => methodNotAllowed(request),
      GET: async ({ request }) => listTags(await getRuntime(), request),
      HEAD: async ({ request }) => headOf(listTags(await getRuntime(), request)),
    },
  },
})
