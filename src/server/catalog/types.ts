export type Integration = {
  key: string
  name: string
  prefix: string
  description?: string
  updatedAt: string
  updatedBy: string
}

export type KeyLocation = 'jsonPath' | 'xPath' | 'query' | 'path' | 'header' | 'form'

export type Endpoint = {
  integration: string
  key: string
  name: string
  method: string
  path: string
  pathType: 'exact' | 'template' | 'regex'
  lookup?: { location: KeyLocation; expression: string }
  contentType: 'json' | 'xml' | 'text' | 'html'
  exampleRequest?: string
  exampleResponses: Record<string, string>
  allowedStatuses: number[]
  description?: string
  links?: { label: string; url: string }[]
  updatedAt: string
  updatedBy: string
}

export interface CatalogStore {
  getIntegration(key: string): Promise<Integration | null>
  listIntegrations(): Promise<Integration[]>
  putIntegration(i: Integration): Promise<void>
  /** Also deletes the integration's endpoints. */
  deleteIntegration(key: string): Promise<void>
  getEndpoint(integration: string, key: string): Promise<Endpoint | null>
  listEndpoints(integration: string): Promise<Endpoint[]>
  putEndpoint(e: Endpoint): Promise<void>
  deleteEndpoint(integration: string, key: string): Promise<void>
}
