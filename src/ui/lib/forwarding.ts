import type { StubMapping } from '@/server/wiremock/types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Where WireMock forwarded a request a proxy mock answered: the base URL, then the request's path (less
 * `proxyUrlPrefixToRemove` when it starts with it) and query. Null for a mock that does not forward.
 */
export function forwardedUrl(stub: Pick<StubMapping, 'response'> | undefined, requestUrl: string): string | null {
  const response = stub && isObj(stub.response) ? stub.response : null
  const base = typeof response?.proxyBaseUrl === 'string' ? response.proxyBaseUrl : null
  if (!base) return null
  const strip = typeof response?.proxyUrlPrefixToRemove === 'string' ? response.proxyUrlPrefixToRemove : ''
  const rest = strip && requestUrl.startsWith(strip) ? requestUrl.slice(strip.length) : requestUrl
  let end = base.length
  while (end > 0 && base[end - 1] === '/') end--
  return base.slice(0, end) + (rest.startsWith('/') || rest.startsWith('?') || rest === '' ? rest : `/${rest}`)
}

/** The webhooks a mock calls after it answers (method and URL as written, templates included). */
export function callbacksOf(stub: StubMapping | undefined): { method: string; url: string }[] {
  const listeners = stub?.serveEventListeners
  if (!Array.isArray(listeners)) return []
  return listeners.flatMap((l: unknown) => {
    if (!isObj(l) || l.name !== 'webhook' || !isObj(l.parameters)) return []
    const { method, url } = l.parameters
    return typeof url === 'string' ? [{ method: typeof method === 'string' ? method.toUpperCase() : 'GET', url }] : []
  })
}
