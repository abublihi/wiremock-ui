import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'

/** Statuses a Response may not carry a body for. */
const NULL_BODY = new Set([101, 103, 204, 205, 304])

/**
 * A minimal fetch over node:http(s) for the test-request relay: it sends exactly the headers it is given (plus Host
 * and the framing headers HTTP needs). fetch (undici) adds its own Accept, Accept-Language, Sec-Fetch-Mode and
 * User-Agent: node, which a mock matching on those headers would see as if the tester had sent them. Never follows
 * redirects and never decompresses.
 */
export function rawFetch(
  url: URL | string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const target = new URL(url)
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  const method = (init.method ?? 'GET').toUpperCase()
  return new Promise<Response>((resolve, reject) => {
    const req = send(target, { method, headers: init.headers ?? {}, signal: init.signal }, (res: IncomingMessage) => {
      const headers = new Headers()
      try {
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1])
        const status = res.statusCode ?? 502
        const empty = NULL_BODY.has(status) || method === 'HEAD'
        if (empty) res.resume()
        resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, statusText: res.statusMessage, headers }))
      } catch (err) {
        res.destroy()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', (err) => reject(init.signal?.aborted ? (init.signal.reason ?? err) : err))
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}
