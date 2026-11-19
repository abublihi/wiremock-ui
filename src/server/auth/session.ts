import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Config } from '../config'

export const SESSION_TTL_SECONDS = 43200
export const LOGIN_WINDOW_SECONDS = 900
export const LOGIN_MAX_ATTEMPTS = 10
export const SESSION_COOKIE = 'wmui_session'

const sign = (id: string, secret: string) => createHmac('sha256', secret).update(id).digest('base64url')

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function signSessionId(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`
}

function verifySessionValue(value: string, secret: string): string | null {
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const id = value.slice(0, dot)
  return safeEqual(value.slice(dot + 1), sign(id, secret)) ? id : null
}

export function readSessionCookie(request: Request, secret: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue
    return verifySessionValue(part.slice(eq + 1).trim(), secret)
  }
  return null
}

const attrs = (maxAge: number, secure: boolean) =>
  `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`

export function sessionCookie(value: string, opts: { secure: boolean }): string {
  return `${SESSION_COOKIE}=${value}; ${attrs(SESSION_TTL_SECONDS, opts.secure)}`
}

export function clearSessionCookie(opts: { secure: boolean }): string {
  return `${SESSION_COOKIE}=; ${attrs(0, opts.secure)}`
}

export function isSecureRequest(request: Request, config: Config): boolean {
  if (config.publicUiUrl?.toLowerCase().startsWith('https://')) return true
  if (config.trustProxy && request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() === 'https') return true
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function clientIp(request: Request, config: Config): string {
  if (config.trustProxy) {
    const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (first) return first
  }
  // srvx's node adapter exposes the socket address as `request.ip`.
  return (request as Request & { ip?: string }).ip || 'unknown'
}
