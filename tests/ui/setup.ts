import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// happy-dom prints every non-2xx fetch ("POST http://… 401 (Unauthorized)") straight to the process
// streams; the tests provoke those on purpose, so drop exactly those lines and nothing else.
const FETCH_LOG = /^(GET|POST|PUT|PATCH|DELETE) https?:\/\/\S+ \d{3}\b/
type Write = typeof process.stderr.write
function quiet(stream: NodeJS.WriteStream) {
  const original = stream.write.bind(stream) as Write
  vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string' && FETCH_LOG.test(chunk)) return true
    return (original as (...a: unknown[]) => boolean)(chunk, ...rest)
  }) as Write)
}
beforeEach(() => {
  quiet(process.stderr)
  quiet(process.stdout)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
