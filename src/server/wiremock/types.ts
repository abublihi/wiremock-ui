export type WireMockUiMeta = {
  integration?: string
  endpoint?: string
  owner: string
  version: number
  updatedAt: string
  updatedBy: string
  source: 'ui' | 'import' | 'seed' | 'recording' | 'marker'
}

export type StubBase = {
  id: string
  name?: string
  priority?: number
  persistent?: boolean
  request: Record<string, unknown>
  response: Record<string, unknown>
  metadata?: { wiremockUi?: WireMockUiMeta } & Record<string, unknown>
}

export type StubMapping = StubBase & Record<string, unknown>
