import { createHash } from 'node:crypto'
import { safeRecord, type AuditLog } from '../audit/log'
import { legacyEndpointsOf, migrateLinkedStubs, type LegacyEndpoint } from '../catalog/migrate'
import { ValidationError } from '../errors'
import { logger } from '../logger'
import { assertValidStub, canonicalJson, type MockService } from '../mocks/service'
import { normaliseTags } from '../mocks/tags'
import { assertGroupMeta } from '../mocks/groups'
import type { MockStore } from '../store/types'
import type { StubMapping } from '../wiremock/types'
import type { Bundle } from './parse'

export type ImportReport = {
  created: number
  updated: number
  unchanged: number
  skipped: { id: string; reason: string }[]
  pruned: number
  ignoredOidcIdentities: number
  /**
   * Dry run only: what happens to each mock of the bundle, in bundle order (`index` into bundle.mocks). Two entries
   * with the same id are one mock: the last one wins.
   */
  items?: ImportItem[]
}

export type ImportItem = { index: number; id: string; outcome: 'created' | 'updated' | 'unchanged' | 'skipped'; reason?: string }

type Deps = {
  /** Endpoints of the retired catalog that stored mocks may still name (src/server/catalog/migrate.ts). */
  legacyEndpoints?: () => Promise<LegacyEndpoint[]>
  mocks: MockService
  store: MockStore
  audit: AuditLog
  /** Re-adds person-owned mocks above baseline ones; called when the import wrote any baseline mock. */
  reposition?: () => Promise<void>
}

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
  opts: { actor: string; prune: boolean; source: 'import' | 'seed'; unreadable?: number; dryRun?: boolean },
): Promise<ImportReport> {
  // Integrations and endpoints are retired: a bundle's mocks linked to them become tagged mocks (and, for an
  // endpoint with a key, one mock with several responses). The bundle's own catalog and the old stored one name them.
  const endpoints = [...legacyEndpointsOf(bundle.catalog), ...((await deps.legacyEndpoints?.()) ?? [])]
  const migrated = migrateLinkedStubs(bundle.mocks, endpoints)

  // Phase 1: validate everything; nothing is written until the whole bundle passes.
  const mocks = new Map<string, StubMapping>()
  const indexOf = new Map<string, number>()
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
    // The id comes from the stub as written, so a re-import of the same file finds the same mocks.
    const id = (given as string | undefined) ?? deterministicId(raw)
    const stub = { ...migrated[i]!, id } as StubMapping
    const ui = stub.metadata?.wiremockUi as { owner?: unknown; tags?: unknown; group?: unknown } | undefined
    if (ui?.owner !== undefined && (typeof ui.owner !== 'string' || ui.owner === '')) {
      throw new ValidationError(`${label}: metadata.wiremockUi.owner must be a non-empty string`)
    }
    invalid(label, () => normaliseTags(ui?.tags))
    invalid(label, () => assertGroupMeta(ui?.group))
    mocks.set(id, stub)
    indexOf.set(id, i)
  })

  if (opts.dryRun) return dryRun(bundle, mocks, indexOf, deps, opts)

  const source = opts.source
  const report: ImportReport = {
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

  // A baseline stub WireMock adds lands above person-owned stubs with the same priority; put them back on top.
  if (deps.reposition && report.created + report.updated > 0) {
    try {
      await deps.reposition()
    } catch (err) {
      logger.error({ err }, 'repositioning person-owned mocks after import failed')
    }
  }

  await safeRecord(deps.audit, { actor: opts.actor, action: 'import', target: 'bundle', details: { ...report } })
  return report
}

/** The report an import would give, plus each mock's outcome; nothing is written and nothing is audited. */
async function dryRun(
  bundle: Bundle,
  mocks: Map<string, StubMapping>,
  indexOf: Map<string, number>,
  deps: Deps,
  opts: { prune: boolean; unreadable?: number },
): Promise<ImportReport> {
  const report: ImportReport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    pruned: 0,
    ignoredOidcIdentities: bundle.oidcIdentities.length,
    items: [],
  }
  for (const [id, stub] of mocks) {
    const index = indexOf.get(id)!
    const existing = await deps.store.get(id)
    const existingOwner = existing ? (existing.metadata?.wiremockUi?.owner ?? 'baseline') : undefined
    if (existingOwner !== undefined && existingOwner !== 'baseline') {
      const reason = `owned by ${existingOwner}`
      report.skipped.push({ id, reason })
      report.items!.push({ index, id, outcome: 'skipped', reason })
      continue
    }
    const outcome = await deps.mocks.importOutcome(stub, stub.metadata?.wiremockUi?.owner ?? 'baseline')
    report[outcome]++
    report.items!.push({ index, id, outcome })
  }
  report.items!.sort((a, b) => a.index - b.index)
  if (opts.prune && !opts.unreadable) {
    for (const stub of await deps.store.listAll()) {
      if ((stub.metadata?.wiremockUi?.owner ?? 'baseline') === 'baseline' && !mocks.has(stub.id)) report.pruned++
    }
  }
  return report
}

function nameOf(raw: unknown, field: string): string {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[field] : undefined
  return typeof v === 'string' ? ` (${v})` : ''
}
