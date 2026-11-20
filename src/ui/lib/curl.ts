import type { Endpoint } from '@/server/catalog/types'
import type { LoggedEvent, StubMapping } from '@/server/wiremock/types'
import { type Pair, type RequestDraft, draftFromStub, loggedHeaders } from './test-request'

export type CurlSpec = {
  method: string
  /** The full URL, already encoded. */
  url: string
  headers?: Pair[]
  /** Sent with --data-raw (exactly as given: no @file, no stripping). */
  body?: string
  /** A `# …` line before the command (a shell ignores it), for something the reader must fix first. */
  comment?: string
}

/** POSIX single-quote shell quoting: everything is literal inside '…'; a ' is closed, escaped and reopened. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const TOKEN = /^[A-Za-z0-9!#$%&*+.^_`|~-]+$/
// curl treats [] and {} in a URL as glob ranges unless told not to.
const GLOB = /[[\]{}]/

/**
 * A curl command, one flag per line with ` \` continuations: `-X` only when curl wouldn't pick the method
 * itself (anything but GET, or a GET that carries a body), `-H` per header, `--data-raw` for the body.
 */
export function buildCurl(spec: CurlSpec): string {
  const method = spec.method.toUpperCase()
  const body = spec.body ?? ''
  const hasBody = body !== ''
  const flags: string[] = []
  if (GLOB.test(spec.url)) flags.push('--globoff')
  const first = [...flags, shellQuote(spec.url)].join(' ')
  const lines: string[] = []
  if (method === 'HEAD' && !hasBody) lines.push('--head')
  else if (method !== 'GET' || hasBody) lines.push(`-X ${TOKEN.test(method) ? method : shellQuote(method)}`)
  for (const { name, value } of spec.headers ?? []) {
    // `Name:` with nothing after it tells curl to remove the header; `Name;` sends it empty.
    lines.push(`-H ${shellQuote(value === '' ? `${name};` : `${name}: ${value}`)}`)
  }
  if (hasBody) lines.push(`--data-raw ${shellQuote(body)}`)
  const command = [`curl ${first}`, ...lines.map((l) => `  ${l}`)].join(' \\\n')
  if (!spec.comment) return command
  return `# ${spec.comment.replace(/[\r\n]+/g, ' ')}\n${command}`
}

/** WireMock's public URL + path + the query, each name and value percent-encoded. */
export function joinUrl(publicUrl: string, path: string, query: Pair[]): string {
  const base = publicUrl.replace(/\/+$/, '')
  const qs = query
    .filter((p) => p.name !== '')
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return `${base}${path.startsWith('/') ? '' : '/'}${path}${qs ? `?${qs}` : ''}`
}

/** A draft (from the test panel) as curl. */
export function curlFromDraft(draft: RequestDraft, publicUrl: string, comment?: string): string {
  return buildCurl({
    method: draft.method,
    url: joinUrl(publicUrl, draft.path, draft.query),
    headers: draft.headers.filter((h) => h.name.trim() !== ''),
    body: draft.body,
    comment,
  })
}

/** A curl that this mock would match (see draftFromStub); a regex path no sample fills is flagged with a comment. */
export function curlFromStub(stub: Pick<StubMapping, 'request'>, endpoint: Pick<Endpoint, 'exampleRequest'> | undefined, publicUrl: string): string {
  const { draft, pathIsPattern } = draftFromStub(stub, endpoint)
  return curlFromDraft(draft, publicUrl, pathIsPattern ? `edit the path: this mock matches the pattern ${draft.path}` : undefined)
}

/** The logged request exactly as it reached WireMock: raw URL, its headers (not the transport's), its body. */
export function curlFromLoggedRequest(event: Pick<LoggedEvent, 'request'>, publicUrl: string): string {
  const url = event.request.url
  return buildCurl({
    method: event.request.method || 'GET',
    url: `${publicUrl.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`,
    headers: loggedHeaders(event),
    body: event.request.body ?? '',
  })
}
