export type WireMockUiMeta = {
  integration?: string
  endpoint?: string
  /** Free-form labels that group mocks (see src/server/mocks/tags.ts); absent when none. */
  tags?: string[]
  /** Set on each stub of a mock with several responses (see src/server/mocks/groups.ts). */
  group?: {
    id: string
    by: { location: 'jsonPath' | 'xPath' | 'query' | 'path' | 'header' | 'form'; expression: string }
    value?: string
    order: number
  }
  owner: string
  version: number
  updatedAt: string
  updatedBy: string
  source: 'ui' | 'import' | 'seed' | 'adopt' | 'wiremock' | 'recording' | 'marker'
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

export type LoggedRequest = {
  url: string
  method: string
  body?: string
  bodyAsBase64?: string
  headers?: Record<string, unknown>
  loggedDate?: number
  loggedDateString?: string
} & Record<string, unknown>

/** An entry of WireMock's request journal (3.13.1). Unmatched events carry a synthetic 404 `stubMapping`. */
export type LoggedEvent = {
  id: string
  request: LoggedRequest
  response?: { status: number; headers?: Record<string, unknown>; body?: string } & Record<string, unknown>
  responseDefinition?: { status?: number } & Record<string, unknown>
  wasMatched: boolean
  stubMapping?: StubMapping
  timing?: { totalTime?: number } & Record<string, unknown>
} & Record<string, unknown>

export type NearMiss = {
  request: Record<string, unknown>
  stubMapping: StubMapping
  matchResult: { distance: number; diffDescriptions?: unknown[] } & Record<string, unknown>
}

/** A scenario as WireMock's `GET /__admin/scenarios` reports it (3.13.1), without its mappings. */
export type ScenarioState = {
  name: string
  state: string
  possibleStates: string[]
}
