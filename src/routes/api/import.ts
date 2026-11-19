import { createFileRoute } from '@tanstack/react-router'
import { runImport } from '../../server/http/handlers/imports'
import { getRuntime } from '../../server/runtime'

export const Route = createFileRoute('/api/import')({
  server: {
    handlers: {
      POST: async ({ request }) => runImport(await getRuntime(), request),
    },
  },
})
