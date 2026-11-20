import { AppError } from '../../errors'
import { parseTestRequest, RELAY_MAX_BODY_BYTES } from '../../wiremock/relay'
import { json, readJson, requireJson, withAuth } from '../wrap'

// The JSON envelope around a 1 MB body: escaping can double it, plus headers and the rest.
const MAX_ENVELOPE_BYTES = 2 * RELAY_MAX_BODY_BYTES + 64 * 1024

/**
 * POST /api/test-request { method, path, query?, headers?, body? } → { status, headers, body, bodyIsBase64,
 * bodyTruncated, durationMs, matchedStubId }. Relays one request to WireMock's stub port (never the admin API,
 * never another host). Not audited: test traffic is noise.
 */
export const sendTestRequest = withAuth(null, async ({ rt, request }) => {
  requireJson(request)
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_ENVELOPE_BYTES) throw new AppError('Request is too large: the test body may be at most 1 MB', 413)
  const input = parseTestRequest(await readJson(request))
  return json(await rt.wiremock.sendTestRequest(input))
})
