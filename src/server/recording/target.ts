import { ValidationError } from '../errors'
import { trimTrailingSlashes } from '../url'

const DEFAULT_PORT: Record<string, string> = { 'http:': '80', 'https:': '443' }

const parse = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const portOf = (url: URL) => url.port || DEFAULT_PORT[url.protocol] || ''
/** Lower-cased, without the trailing dot of a fully qualified name. */
const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/\.$/, '')

/**
 * True for a host that means "this machine" to whoever connects to it: localhost and *.localhost, 127.0.0.0/8,
 * ::1, IPv4-mapped 127.x, and the unspecified 0.0.0.0 / ::. The URL parser has already canonicalised spellings
 * like 127.1, 0x7f.0.0.1, 2130706433 and [::ffff:127.0.0.1] (→ [::ffff:7f00:1]).
 */
export function isLoopbackHost(url: URL): boolean {
  const host = hostOf(url)
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host === '0.0.0.0') return true
  if (host === '[::1]' || host === '[::]') return true
  // IPv4-mapped IPv6: [::ffff:7fxx:xxxx] is 127.x.x.x, [::ffff:0:0] is 0.0.0.0.
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(host)
  if (mapped) {
    const high = parseInt(mapped[1], 16)
    return high >> 8 === 0x7f || (high === 0 && parseInt(mapped[2], 16) === 0)
  }
  return false
}

const LOOP =
  'Target URL is WireMock itself, so every request would loop back to WireMock. Enter the real service you want to record.'
const APP = 'Target URL is this app. Enter the real service you want to record.'

/**
 * The base URL WireMock forwards to while recording (spec A12), normalised (no trailing slash). WireMock accepts
 * anything, so this is the only check. WireMock is the one that connects, so a loopback host means WireMock's own
 * machine: on WireMock's port that is WireMock itself (an endless proxy loop that starves it), on the app's port
 * the app. Also refused: other schemes, credentials, query or fragment, `/__admin`, WireMock's and the app's URLs.
 * `wiremock`: WIREMOCK_URL and WIREMOCK_PUBLIC_URL; `app`: where the app is reached (and its own port).
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

  const port = portOf(url)
  const loopback = isLoopbackHost(url)
  const urls = (list: string[]) => list.map(parse).filter((u): u is URL => u !== null)
  const hits = (list: URL[]) =>
    list.some((u) => portOf(u) === port && (loopback || (hostOf(u) === hostOf(url)) || (isLoopbackHost(u) && loopback)))
  if (hits(urls(refused.wiremock))) throw new ValidationError(LOOP)
  if (hits(urls(refused.app))) throw new ValidationError(APP)
  return `${url.protocol}//${url.host}${trimTrailingSlashes(url.pathname)}`
}
