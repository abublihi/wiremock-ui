import { createHash } from 'node:crypto'
import type { AuditLog } from '../audit/log'
import { longestPrefixMatch } from '../catalog/prefix'
import { validateEndpoint, validateIntegration, type CatalogService } from '../catalog/service'
import { ValidationError } from '../errors'
import { logger } from '../logger'
import { assertValidStub, canonicalJson, type MockService } from '../mocks/service'
import type { MockStore } from '../store/types'
import type { StubMapping } from '../wiremock/types'
import type { Bundle } from './parse'

export type ImportReport = {
  integrations: number
  endpoints: number
  created: number
  updated: number
  unchanged: number
  skipped: { id: string; reason: string }[]
  pruned: number
  ignoredOidcIdentities: number
}

type Deps = { catalog: CatalogService; mocks: MockService; store: MockStore; audit: AuditLog }

const URL_FIELDS = ['url', 'urlPath', 'urlPathTemplate'] as const

/** Version-5-style UUID from the SHA-1 of the stub without id/uuid/wiremockUi metadata. */
export function deterministicId(stub: Record<string, unknown>): string {
  const { id: _id, uuid: _uuid, metadata, ...rest } = stub
  const meta = typeof metadata === 'object' && metadata !== null ? { ...(metadata as Record<string, unknown>) } : undefined
  if (meta) delete meta.wiremockUi
  const hex = createHash('sha1')
    .update(canonicalJson({ ...rest, ...(meta && Object.keys(meta).length ? { metadata: meta } : {}) }))
    .digest('hex')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function guessIntegration(stub: StubMapping, prefixes: { key: string; prefix: string }[]): string | undefined {
  const urls = URL_FIELDS.map((f) => stub.request[f]).filter((u): u is string => typeof u === 'string')
  return longestPrefixMatch(urls, prefixes)
}

const invalid = <T>(what: string, fn: () => T): T => {
  try {
    return fn()
  } catch (err) {
    if (err instanceof ValidationError) throw new ValidationError(`${what}: ${err.message}`)
    throw err
  }
}

export async function importBundle(
  bundle: Bundle,
  deps: Deps,
  opts: { actor: string; prune: boolean; source: 'import' | 'seed'; unreadable?: number },
): Promise<ImportReport> {
  // Phase 1: validate everything; nothing is written until the whole bundle passes.
  const integrations = bundle.integrations.map((raw, i) =>
    invalid(`integrations[${i}]${nameOf(raw, 'key')}`, () => validateIntegration(raw)),
  )
  const known = new Set((await deps.catalog.listIntegrations()).map((i) => i.key))
  const bundleKeys = new Set(integrations.map((i) => i.key))
  const endpoints = bundle.catalog.map((raw, i) =>
    invalid(`catalog[${i}]${nameOf(raw, 'key')}`, () => {
      const e = validateEndpoint(raw)
      if (!bundleKeys.has(e.integration) && !known.has(e.integration)) {
        throw new ValidationError(`integration "${e.integration}" does not exist`)
      }
      return e
    }),
  )

  const prefixes = new Map((await deps.catalog.listIntegrations()).map((i) => [i.key, i.prefix]))
  for (const i of integrations) prefixes.set(i.key, i.prefix)
  const prefixList = [...prefixes].map(([key, prefix]) => ({ key, prefix }))

  const mocks = new Map<string, StubMapping>()
  bundle.mocks.forEach((raw, i) => {
    const label = `mocks[${i}]${nameOf(raw, 'id')}`
    invalid(label, () => assertValidStub(raw))
    if ('metadata' in raw && raw.metadata !== undefined && (typeof raw.metadata !== 'object' || raw.metadata === null || Array.isArray(raw.metadata))) {
      throw new ValidationError(`${label}: metadata must be an object`)
    }
    const given = raw.id ?? raw.uuid
    if (given !== undefined && (typeof given !== 'string' || given === '')) {
      throw new ValidationError(`${label}: id must be a non-empty string`)
    }
    const id = (given as string | undefined) ?? deterministicId(raw)
    const ui = raw.metadata?.wiremockUi as { owner?: unknown; integration?: unknown } | undefined
    const stub = { ...raw, id } as StubMapping
    if (ui?.owner !== undefined && (typeof ui.owner !== 'string' || ui.owner === '')) {
      throw new ValidationError(`${label}: metadata.wiremockUi.owner must be a non-empty string`)
    }
    if (typeof ui?.integration !== 'string') {
      const guess = guessIntegration(stub, prefixList)
      if (guess) {
        stub.metadata = { ...stub.metadata, wiremockUi: { ...(ui as object), integration: guess } as never }
      }
    }
    mocks.set(id, stub)
  })

  // Phase 2: write.
  for (const i of integrations) await deps.catalog.upsertIntegration(i, opts.actor)
  for (const e of endpoints) await deps.catalog.upsertEndpoint(e, opts.actor)

  const source = opts.source
  const report: ImportReport = {
    integrations: integrations.length,
    endpoints: endpoints.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    pruned: 0,
    ignoredOidcIdentities: bundle.oidcIdentities.length,
  }
  for (const [id, stub] of mocks) {
    const existing = await deps.store.get(id)
    const existingOwner = existing ? (existing.metadata?.wiremockUi?.owner ?? 'baseline') : undefined
    if (existingOwner !== undefined && existingOwner !== 'baseline') {
      report.skipped.push({ id, reason: `owned by ${existingOwner}` })
      continue
    }
    const owner = stub.metadata?.wiremockUi?.owner ?? 'baseline'
    report[await deps.mocks.upsertImported(stub, owner, source, opts.actor)]++
  }

  // Unreadable seed entries may hold mocks we cannot see: pruning could delete them.
  if (opts.prune && !opts.unreadable) {
    for (const stub of await deps.store.listAll()) {
      if ((stub.metadata?.wiremockUi?.owner ?? 'baseline') !== 'baseline' || mocks.has(stub.id)) continue
      await deps.mocks.deleteImported(stub.id)
      report.pruned++
    }
  }

  try {
    await deps.audit.record({ actor: opts.actor, action: 'import', target: 'bundle', details: { ...report } })
  } catch (err) {
    logger.error({ err }, 'audit record failed')
  }
  return report
}

function nameOf(raw: unknown, field: string): string {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[field] : undefined
  return typeof v === 'string' ? ` (${v})` : ''
}
