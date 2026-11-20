import type { StubMapping } from '../wiremock/types'

/**
 * The stub WireMock adds while recording (pinned in recording.test.ts): `{ request: { method: ANY },
 * response: { proxyBaseUrl } }`, nothing else and no UI metadata. It is WireMock's, not a mock: a full sync,
 * adoption and the WireMock-only mock list leave it alone.
 */
export function isRecordingProxy(stub: Pick<StubMapping, 'request' | 'response' | 'metadata'>): boolean {
  if (stub.metadata?.wiremockUi) return false
  const req = stub.request
  return (
    typeof stub.response?.proxyBaseUrl === 'string' &&
    req !== undefined &&
    Object.keys(req).length === 1 &&
    req.method === 'ANY'
  )
}
