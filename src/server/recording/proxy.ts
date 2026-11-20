import type { WireMockClient } from '../wiremock/client'
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

/**
 * isRecordingProxy while WireMock is recording; otherwise nothing is the recording's proxy stub, so a person's own
 * catch-all proxy stub of the same shape is listed, adopted and synced like any other. When the recording status
 * cannot be read, it is treated as recording (the stub is kept, never deleted).
 */
export async function recordingProxyMatcher(wiremock: Pick<WireMockClient, 'recordingStatus'>): Promise<(stub: Pick<StubMapping, 'request' | 'response' | 'metadata'>) => boolean> {
  const recording = await Promise.resolve()
    .then(() => wiremock.recordingStatus())
    .then(
    (status) => status === 'Recording',
    () => true,
  )
  return recording ? isRecordingProxy : () => false
}
