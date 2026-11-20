import { AppError, ValidationError } from '../../errors'
import { parseTestRequest, RELAY_MAX_BODY_BYTES } from '../../wiremock/relay'
import { json, requireJson, withAuth } from '../wrap'

// The JSON envelope around a 1 MB body: escaping can double it, plus headers and the rest.
export const MAX_ENVELOPE_BYTES = 2 * RELAY_MAX_BODY_BYTES + 64 * 1024

const tooLarge = () => new AppError('Request is too large: the test body may be at most 1 MB', 413)

/** Reads the request body as JSON, stopping at the limit whether or not a Content-Length was sent (chunked). */
async function readJsonCapped(request: Request, limit = MAX_ENVELOPE_BYTES): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw tooLarge()
  const chunks: Uint8Array[] = []
  let size = 0
  if (request.body) {
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw tooLarge()
      }
      chunks.push(value)
    }
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
}

/**
 * POST /api/test-request { method, path, query?, headers?, body? } → { status, headers, body, bodyIsBase64,
 * bodyTruncated, durationMs, matchedStubId }. Relays one request to WireMock's stub port (never the admin API,
 * never another host). Not audited: test traffic is noise.
 */
export const sendTestRequest = withAuth(null, async ({ rt, request }) => {
  requireJson(request)
  const input = parseTestRequest(await readJsonCapped(request))
  return json(await rt.wiremock.sendTestRequest(input))
})
