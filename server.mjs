// Production entry: serves the built TanStack Start app on Node.
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import server from './dist/server/server.js'

serve({
  port: Number(process.env.PORT || 3000),
  middleware: [staticMiddleware({ dir: './dist/client' })],
  fetch: (request) => server.fetch(request),
})
