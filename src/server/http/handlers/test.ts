import { parseTestRequest, RELAY_MAX_BODY_BYTES } from '../../wiremock/relay'
import { json, readJsonCapped, requireJson, withAuth } from '../wrap'

/**
 * The JSON envelope around a 1 MB body: JSON escaping can make a body up to six times longer (\u0000), plus headers
 * and the rest. The relay checks the body itself against 1 MB once decoded, so the message names that limit.
 */
export const MAX_ENVELOPE_BYTES = 6 * RELAY_MAX_BODY_BYTES + 64 * 1024
const TOO_LARGE = 'Request is too large: the test body may be at most 1 MB'

/**
 * POST /api/test-request { method, path, query?, headers?, body? } → { status, headers, body, bodyIsBase64,
 * bodyTruncated, durationMs, matchedStubId }. Relays one request to WireMock's stub port (never the admin API,
 * never another host). Not audited: test traffic is noise.
 */
export const sendTestRequest = withAuth(null, async ({ rt, request }) => {
  requireJson(request)
  const input = parseTestRequest(await readJsonCapped(request, MAX_ENVELOPE_BYTES, TOO_LARGE))
  return json(await rt.wiremock.sendTestRequest(input))
})
