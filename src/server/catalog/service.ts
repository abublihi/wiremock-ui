import { z } from 'zod'
import type { AuditLog } from '../audit/log'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import type { MockStore } from '../store/types'
import type { CatalogStore, Endpoint, Integration } from './types'

const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'] as const
const LOCATIONS = ['jsonPath', 'xPath', 'query', 'path', 'header', 'form'] as const

const str = (field: string) => z.string({ error: `${field} must be a string` })
const keyField = (field: string) =>
  str(field).regex(KEY, `${field} must be 1–63 characters: a-z, 0-9 or -, starting with a letter or digit`)
const body = <T extends z.ZodRawShape>(schema: T) =>
  z.strictObject(schema, {
    error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object'),
  })

const integrationSchema = body({
  key: keyField('key'),
  name: str('name').min(1, 'name must not be empty'),
  prefix: str('prefix'),
  description: str('description').optional(),
})

const endpointSchema = body({
  integration: keyField('integration'),
  key: keyField('key'),
  name: str('name').min(1, 'name must not be empty'),
  method: z.enum(METHODS, { error: `method must be one of ${METHODS.join(', ')}` }),
  path: str('path'),
  pathType: z.enum(['exact', 'template', 'regex'], { error: 'pathType must be one of exact, template, regex' }),
  lookup: body({
    location: z.enum(LOCATIONS, { error: `lookup.location must be one of ${LOCATIONS.join(', ')}` }),
    expression: str('lookup.expression').min(1, 'lookup.expression must not be empty'),
  }).optional(),
  contentType: z.enum(['json', 'xml', 'text', 'html'], { error: 'contentType must be one of json, xml, text, html' }),
  exampleRequest: str('exampleRequest').optional(),
  exampleResponses: z.record(str('exampleResponses key'), str('exampleResponses value'), {
    error: 'exampleResponses must be an object of status → body text',
  }),
  allowedStatuses: z.array(z.number({ error: 'allowedStatuses must be numbers' }).int('allowedStatuses must be integers'), {
    error: 'allowedStatuses must be an array',
  }),
  description: str('description').optional(),
  links: z
    .array(body({ label: str('links.label'), url: str('links.url') }), { error: 'links must be an array' })
    .optional(),
})

function shape<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue.path.map(String)
  const last = path[path.length - 1]
  throw new ValidationError(!last || issue.message.includes(last) ? issue.message : `${path.join('.')}: ${issue.message}`)
}

const fail = (message: string): never => {
  throw new ValidationError(message)
}

function checkIntegration(i: z.infer<typeof integrationSchema>): void {
  if (!i.prefix.startsWith('/')) fail('prefix must start with /')
  if (i.prefix !== '/' && i.prefix.endsWith('/')) fail('prefix must not end with /')
  if (/[?#]/.test(i.prefix)) fail('prefix must not contain ? or #')
}

function checkEndpoint(e: z.infer<typeof endpointSchema>): void {
  if (!e.path.startsWith('/')) fail('path must start with /')
  if (e.pathType === 'regex') {
    try {
      new RegExp(e.path)
    } catch {
      fail('path must be a valid regular expression')
    }
  }
  if (e.lookup) {
    const { location, expression } = e.lookup
    if (location === 'path') {
      if (e.pathType !== 'template') fail('lookup.location path requires pathType template')
      const names = [...e.path.matchAll(/\{([^{}/]+)\}/g)].map((m) => m[1])
      if (!names.includes(expression)) fail(`lookup.expression must name a {name} segment of path (${names.join(', ') || 'none found'})`)
    }
    if (location === 'jsonPath' && !expression.startsWith('$')) fail('lookup.expression for jsonPath must start with $')
    if (location === 'xPath' && !expression.startsWith('/')) fail('lookup.expression for xPath must start with /')
  }
  e.links?.forEach((link, i) => {
    if (!/^https?:\/\/\S+$/i.test(link.url)) fail(`links.${i}.url must be an http(s) URL`)
  })
  for (const s of e.allowedStatuses) if (s < 100 || s > 599) fail('allowedStatuses must be between 100 and 599')
  for (const status of Object.keys(e.exampleResponses)) {
    if (!/^[1-5]\d\d$/.test(status)) fail(`exampleResponses key "${status}" must be a 3-digit status`)
  }
  if (e.contentType === 'json') {
    const examples: [string, string | undefined][] = [
      ['exampleRequest', e.exampleRequest],
      ...Object.entries(e.exampleResponses).map(([s, b]): [string, string] => [`exampleResponses.${s}`, b]),
    ]
    for (const [field, text] of examples) {
      if (!text || text.trim() === '') continue
      try {
        JSON.parse(text)
      } catch {
        fail(`${field} must be valid JSON when contentType is json`)
      }
    }
  }
}

/** Pure validation shared with the bundle importer; throws ValidationError. */
export function validateIntegration(input: unknown) {
  const parsed = shape(integrationSchema, input)
  checkIntegration(parsed)
  return parsed
}

export function validateEndpoint(input: unknown) {
  const parsed = shape(endpointSchema, input)
  checkEndpoint(parsed)
  return parsed
}

export class CatalogService {
  private readonly catalog: CatalogStore
  private readonly audit: AuditLog
  private readonly mocks: MockStore
  private readonly now: () => Date

  constructor(deps: { catalog: CatalogStore; audit: AuditLog; mocks: MockStore; now?: () => Date }) {
    this.catalog = deps.catalog
    this.audit = deps.audit
    this.mocks = deps.mocks
    this.now = deps.now ?? (() => new Date())
  }

  listIntegrations(): Promise<Integration[]> {
    return this.catalog.listIntegrations()
  }

  async getIntegration(key: string): Promise<Integration> {
    return (await this.catalog.getIntegration(key)) ?? Promise.reject(new NotFoundError('Integration not found'))
  }

  async upsertIntegration(input: unknown, actor: string): Promise<Integration> {
    const parsed = validateIntegration(input)
    const stored: Integration = { ...parsed, updatedAt: this.now().toISOString(), updatedBy: actor }
    await this.catalog.putIntegration(stored)
    await this.audit.record({ actor, action: 'catalog.integration.upsert', target: stored.key })
    return stored
  }

  async deleteIntegration(key: string, actor: string): Promise<void> {
    await this.getIntegration(key)
    if ((await this.mocks.list({ integration: key })).length > 0) throw new ConflictError('Integration still has mocks')
    await this.catalog.deleteIntegration(key)
    await this.audit.record({ actor, action: 'catalog.integration.delete', target: key })
  }

  async listEndpoints(integration: string): Promise<Endpoint[]> {
    await this.getIntegration(integration)
    return this.catalog.listEndpoints(integration)
  }

  async getEndpoint(integration: string, key: string): Promise<Endpoint> {
    await this.getIntegration(integration)
    return (await this.catalog.getEndpoint(integration, key)) ?? Promise.reject(new NotFoundError('Endpoint not found'))
  }

  async upsertEndpoint(input: unknown, actor: string): Promise<Endpoint> {
    const parsed = validateEndpoint(input)
    await this.getIntegration(parsed.integration)
    const stored: Endpoint = { ...parsed, updatedAt: this.now().toISOString(), updatedBy: actor }
    await this.catalog.putEndpoint(stored)
    await this.audit.record({ actor, action: 'catalog.endpoint.upsert', target: `${stored.integration}/${stored.key}` })
    return stored
  }

  async deleteEndpoint(integration: string, key: string, actor: string): Promise<void> {
    await this.getEndpoint(integration, key)
    await this.catalog.deleteEndpoint(integration, key)
    await this.audit.record({ actor, action: 'catalog.endpoint.delete', target: `${integration}/${key}` })
  }
}
