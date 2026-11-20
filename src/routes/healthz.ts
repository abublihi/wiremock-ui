import { createFileRoute } from '@tanstack/react-router'
import { healthz } from '../server/http/handlers/health'
import { getRuntime } from '../server/runtime'
import { headOf } from '../server/http/handlers/fallback'

export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async ({ request }) => healthz(await getRuntime(), request),
      HEAD: async ({ request }) => headOf(healthz(await getRuntime(), request)),
    },
  },
})
