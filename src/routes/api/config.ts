import { createFileRoute } from '@tanstack/react-router'
import { getConfig } from '../../server/http/handlers/config'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/config')({
  server: {
    handlers: {
      GET: async ({ request }) => getConfig(await getRuntime(), request),
    },
  },
})
