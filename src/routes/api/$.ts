import { createFileRoute } from '@tanstack/react-router'
import { apiNotFound } from '../../server/http/handlers/fallback'

/** Every /api URL no other route matches answers JSON 404 (not the page router's HTML-only message). */
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: async ({ request }) => apiNotFound(request),
    },
  },
})
