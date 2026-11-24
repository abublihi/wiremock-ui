import { strToU8, zipSync } from 'fflate'
import { ValidationError } from '../../errors'
import type { Bundle } from '../../bundle/shape'
import type { StubMapping } from '../../wiremock/types'
import { json, withAuth } from '../wrap'

const SCOPES = ['all', 'tag', 'mine'] as const
const FORMATS = ['bundle', 'mappings'] as const
type Scope = (typeof SCOPES)[number]
type Format = (typeof FORMATS)[number]

function pick<T extends string>(value: string | null, allowed: readonly T[], field: string): T {
  const v = value || allowed[0]
  if (!allowed.includes(v as T)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`)
  return v as T
}

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
 * GET /api/export?scope=all|tag|mine&tag=&format=bundle|mappings.
 * `bundle`: one JSON file POST /api/import accepts ({ mocks }, with their tags and groups in metadata.wiremockUi).
 * `mappings`: a zip of mappings/<name>-<id>.json, one stub per file, as WireMock loads from its own folder.
 * Works on every driver; in WireMock-only mode the mocks come from WireMock.
 */
export const exportMocks = withAuth('mocks.read', async ({ rt, request, principal }) => {
  const q = new URL(request.url).searchParams
  const scope: Scope = pick(q.get('scope'), SCOPES, 'scope')
  const format: Format = pick(q.get('format'), FORMATS, 'format')
  const tag = q.get('tag')?.trim().toLowerCase() || undefined
  if (scope === 'tag' && !tag) throw new ValidationError('tag is required when scope is tag')

  const filter = scope === 'tag' ? { tag } : scope === 'mine' ? { owner: principal.user.username } : {}
  const mocks: StubMapping[] = await rt.mocks.list(filter)
  const label = scope === 'tag' ? slug(tag) : scope
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

  const bundle: Bundle = { integrations: [], catalog: [], mocks, oidcIdentities: [] }
  return json(bundle, 200, { 'Content-Disposition': attachment(`wiremock-ui-${label}-${stamp(now)}.json`) })
})
