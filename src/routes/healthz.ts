import { createFileRoute } from '@tanstack/react-router'
import { healthz } from '../server/http/handlers'
import { getRuntime } from '../server/runtime'

export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async ({ request }) => healthz(await getRuntime(), request),
    },
  },
})
