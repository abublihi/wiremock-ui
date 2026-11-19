export type WireMockUiMeta = {
  integration?: string
  endpoint?: string
  owner: string
  version: number
  updatedAt: string
  updatedBy: string
  source: 'ui' | 'import' | 'seed' | 'recording' | 'marker'
}

export type StubMapping = {
  id: string
  name?: string
  priority?: number
  persistent?: boolean
  request: Record<string, unknown>
  response: Record<string, unknown>
  metadata?: { wiremockUi?: WireMockUiMeta } & Record<string, unknown>
} & Record<string, unknown>
