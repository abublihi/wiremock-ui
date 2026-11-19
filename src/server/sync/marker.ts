import type { StubMapping } from '../wiremock/types'

export const MARKER_ID = '5e1f0000-0000-4000-8000-00000000c0de'

export function markerStub(): StubMapping {
  return {
    id: MARKER_ID,
    name: 'wiremock-ui marker',
    persistent: false,
    request: { method: 'GET', urlPath: '/__wiremock-ui/marker' },
    response: { status: 204 },
    metadata: {
      wiremockUi: {
        owner: 'system',
        version: 1,
        updatedAt: '1970-01-01T00:00:00.000Z',
        updatedBy: 'system',
        source: 'marker',
      },
    },
  }
}
