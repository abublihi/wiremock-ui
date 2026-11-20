import { strToU8, zipSync } from 'fflate'
import type { Endpoint, Integration } from '../../catalog/types'
import { ValidationError } from '../../errors'
import type { Bundle } from '../../bundle/shape'
import type { StubMapping } from '../../wiremock/types'
import { json, withAuth } from '../wrap'

const SCOPES = ['all', 'integration', 'mine'] as const
const FORMATS = ['bundle', 'mappings'] as const
type Scope = (typeof SCOPES)[number]
type Format = (typeof FORMATS)[number]

function pick<T extends string>(value: string | null, allowed: readonly T[], field: string): T {
  const v = value || allowed[0]
  if (!allowed.includes(v as T)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
  return v as T
}

/** Catalog entries without the fields the server owns, so the bundle imports as it is. */
const integrationOut = ({ updatedAt: _a, updatedBy: _b, ...rest }: Integration) => rest
const endpointOut = ({ updatedAt: _a, updatedBy: _b, ...rest }: Endpoint) => rest

/** "Logo / PNG" → "logo-png"; empty → "mock". Ids keep file names unique. */
export function slug(name: unknown): string {
  const s = (typeof name === 'string' ? name : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return s || 'mock'
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)

function attachment(filename: string): string {
  return `attachment; filename="${filename}"`
}

/**
 * GET /api/export?scope=all|integration|mine&integration=&format=bundle|mappings (spec A6, partly pulled forward).
 * `bundle`: one JSON file POST /api/import accepts (integrations, catalog, mocks, oidcIdentities: []).
 * `mappings`: a zip of mappings/<name>-<id>.json, one stub per file, as WireMock loads from its own folder.
 * Works on every driver; in WireMock-only mode the mocks come from WireMock and the catalog from memory.
 */
export const exportMocks = withAuth('mocks.read', async ({ rt, request, principal }) => {
  const q = new URL(request.url).searchParams
  const scope: Scope = pick(q.get('scope'), SCOPES, 'scope')
  const format: Format = pick(q.get('format'), FORMATS, 'format')
  const key = q.get('integration') || undefined
  if (scope === 'integration' && !key) throw new ValidationError('integration is required when scope is integration')

  const filter = scope === 'integration' ? { integration: key } : scope === 'mine' ? { owner: principal.user.username } : {}
  let integrations: Integration[]
  if (scope === 'integration') integrations = [await rt.catalog.getIntegration(key!)]
  else integrations = await rt.catalog.listIntegrations()
  const mocks: StubMapping[] = await rt.mocks.list(filter)

  // "Mine" carries only the integrations and endpoints its mocks link to.
  if (scope === 'mine') {
    const used = new Set(mocks.map((m) => m.metadata?.wiremockUi?.integration).filter(Boolean))
    integrations = integrations.filter((i) => used.has(i.key))
  }
  const label = scope === 'integration' ? key! : scope
  const now = new Date()

  if (format === 'mappings') {
    const files: Record<string, Uint8Array> = {}
    for (const stub of mocks) files[`mappings/${slug(stub.name)}-${stub.id}.json`] = strToU8(`${JSON.stringify(stub, null, 2)}\n`)
    const zip = zipSync(files, { level: 6, mtime: now })
    return new Response(zip, {
      status: 200,
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(`wiremock-ui-${label}-mappings-${stamp(now)}.zip`) },
    })
  }

  const endpoints: Endpoint[] = []
  for (const i of integrations) endpoints.push(...(await rt.catalog.listEndpoints(i.key)))
  const linked = scope === 'mine' ? new Set(mocks.map((m) => `${m.metadata?.wiremockUi?.integration}/${m.metadata?.wiremockUi?.endpoint}`)) : null
  const bundle: Bundle = {
    integrations: integrations.map(integrationOut),
    catalog: endpoints.filter((e) => !linked || linked.has(`${e.integration}/${e.key}`)).map(endpointOut),
    mocks,
    oidcIdentities: [],
  }
  return json(bundle, 200, { 'Content-Disposition': attachment(`wiremock-ui-${label}-${stamp(now)}.json`) })
})
