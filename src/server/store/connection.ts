import { Redis } from 'ioredis'
import { logger } from '../logger'

/** Log connection errors at warn, at most once per 10 s per connection. */
export function logErrors(conn: Redis): void {
  let last = 0
  conn.on('error', (err) => {
    const now = Date.now()
    if (now - last < 10_000) return
    last = now
    logger.warn({ err: err.message }, 'redis connection error')
  })
}

export function createRedis(url: string): Redis {
  const conn = new Redis(url)
  logErrors(conn)
  return conn
}
