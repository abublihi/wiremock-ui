import { timingSafeEqual } from 'node:crypto'
import type { Config } from '../config'
import { AppError } from '../errors'

// timingSafeEqual needs equal-length buffers: pad both, then also require equal length.
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  const size = Math.max(x.length, y.length, 1)
  const px = Buffer.alloc(size)
  const py = Buffer.alloc(size)
  x.copy(px)
  y.copy(py)
  return timingSafeEqual(px, py) && x.length === y.length
}

export function requireBasicAuth(request: Request, config: Pick<Config, 'adminUser' | 'adminPassword'>): string {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Basic\s+(.+)$/i.exec(header)
  if (match) {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    const i = decoded.indexOf(':')
    if (i >= 0) {
      const user = decoded.slice(0, i)
      const password = decoded.slice(i + 1)
      const userOk = safeEqual(user, config.adminUser)
      const passOk = safeEqual(password, config.adminPassword)
      if (userOk && passOk) return user
    }
  }
  throw new AppError('Authentication required', 401)
}
