import { ValidationError } from '../errors'

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|\[::\])$/i
const DEFAULT_PORT: Record<string, string> = { 'http:': '80', 'https:': '443' }

/** host:port with default ports filled in and every loopback spelling folded together. */
function hostKey(url: URL): string {
  const host = LOOPBACK.test(url.hostname) ? 'loopback' : url.hostname.toLowerCase()
  return `${host}:${url.port || DEFAULT_PORT[url.protocol] || ''}`
}

const parse = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * The base URL WireMock forwards to while recording (spec A12), normalised (no trailing slash). WireMock itself
 * accepts anything, so this is the only check: http(s) only, no credentials, query or fragment, not WireMock
 * (`wiremock`: its URLs, compared by host and port — a loop) and not this app (`app`), and no `/__admin` path.
 */
export function validateTarget(raw: string, refused: { wiremock: string[]; app: string[] }): string {
  const value = raw.trim()
  if (value === '') throw new ValidationError('Enter the target URL, like https://api.example.com')
  const url = parse(value)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.host === '') {
    throw new ValidationError('Target URL must start with http:// or https://')
  }
  if (url.username !== '' || url.password !== '') throw new ValidationError('Target URL must not contain a user name or password')
  if (url.search !== '' || url.hash !== '' || /[?#]/.test(value)) throw new ValidationError('Target URL must not contain a query string or #fragment')
  if (/(^|\/)__admin(\/|$)/i.test(url.pathname)) throw new ValidationError('Target URL must not point at a WireMock admin API (/__admin)')
  const key = hostKey(url)
  const same = (list: string[]) => list.some((u) => {
    const other = parse(u)
    return other !== null && hostKey(other) === key
  })
  if (same(refused.wiremock)) {
    throw new ValidationError('Target URL is WireMock itself, so every request would loop back to WireMock. Enter the real service you want to record.')
  }
  if (same(refused.app)) throw new ValidationError('Target URL is this app. Enter the real service you want to record.')
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}
