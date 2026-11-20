import { createStartHandler, defaultStreamHandler, createServerEntry } from '@tanstack/react-start/server'
import { bootEagerly } from './server/runtime'

// Boot (config check, WireMock/store checks, first full sync) when the server
// bundle loads, not on the first request. The dev server boots lazily instead.
if (!import.meta.env.DEV) bootEagerly()

export default createServerEntry({ fetch: createStartHandler(defaultStreamHandler) })
