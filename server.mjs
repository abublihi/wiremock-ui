// Production entry: serves the built TanStack Start app on Node.
import pino from 'pino'
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import server from './dist/server/server.js'

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const port = Number(process.env.PORT || 3000)

const instance = serve({
  port,
  silent: true,
  middleware: [staticMiddleware({ dir: './dist/client' })],
  fetch: (request) => server.fetch(request),
})
await instance.ready()
log.info({ url: instance.url, port }, 'listening')
