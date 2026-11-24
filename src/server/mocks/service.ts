import { safeRecord, type AuditLog } from '../audit/log'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors'
import { logger } from '../logger'
import { newestFirst, pageMocks, type MockPage } from './paging'
import { assertPowerFields, normalisePowerFields } from './power-fields'
import { normaliseTags, tagsOf } from './tags'
import type { MockStore } from '../store/types'
import type { PublicUser } from '../users/types'
import type { WireMockClient } from '../wiremock/client'
import type { StubBase, StubMapping, WireMockUiMeta } from '../wiremock/types'

export type MockInput = Omit<StubBase, 'id' | 'metadata'> & {
  metadata?: { wiremockUi?: Partial<Pick<WireMockUiMeta, 'integration' | 'endpoint' | 'tags'>> } & Record<
    string,
    unknown
  >
}

type Deps = {
  wiremock: WireMockClient
  store: MockStore
  audit: AuditLog
  now?: () => Date
  newId?: () => string
  /** WireMock-only mode (spec A10): the store writes WireMock itself, so the service does not write it first. */
  storeIsWireMock?: boolean
}

const URL_FIELDS = ['url', 'urlPath', 'urlPattern', 'urlPathPattern', 'urlPathTemplate'] as const

function matchesQuery(stub: StubMapping, q: string): boolean {
  const has = (v: unknown) => typeof v === 'string' && v.toLowerCase().includes(q)
  return (
    has(stub.name) ||
    URL_FIELDS.some((f) => has(stub.request[f])) ||
    JSON.stringify(stub.request).toLowerCase().includes(q)
  )
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Shape and content rules for a stub arriving from a bundle; throws ValidationError. */
export function assertValidStub(stub: unknown): asserts stub is Record<string, unknown> & Pick<StubBase, 'request' | 'response'> {
  if (!isObject(stub)) throw new ValidationError('mock must be an object')
  if (!isObject(stub.request)) throw new ValidationError('mock.request must be an object')
  if (!isObject(stub.response)) throw new ValidationError('mock.response must be an object')
  if ('bodyFileName' in stub.response) throw new ValidationError('bodyFileName is not supported; put the body inline')
  // Here too, so a bundle import refuses a bad proxy, webhook or scenario field before writing anything.
  assertPowerFields(stub as Pick<StubBase, 'response'> & Record<string, unknown>)
}

const IGNORED_META = ['version', 'updatedAt', 'updatedBy', 'source'] as const

/** Canonical JSON (sorted keys, undefined dropped) of a stub minus the fields an import may change. */
function comparable(stub: StubMapping): string {
  const { persistent: _p, ...rest } = stub
  const ui = { ...(stub.metadata?.wiremockUi ?? {}) } as Record<string, unknown>
  for (const k of IGNORED_META) delete ui[k]
  // Saving normalises proxy/webhook fields, so an import of the un-normalised original is unchanged.
  return canonicalJson(normalisePowerFields({ ...rest, metadata: { ...stub.metadata, wiremockUi: ui } }))
}

export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : isObject(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, sort(v[k])]),
          )
        : v
  return JSON.stringify(sort(value))
}

/** How a mock entered the store other than through the editor. */
export type ImportSource = 'import' | 'seed'
/** How a mock entered the store other than through the editor or an import: an accepted recording (spec A12). */
export type CreateSource = ImportSource | 'recording'

/** A stub from a bundle as an import stores it: checked, its tags normalised, `owner` set, no uuid. */
function importedStub(stub: StubMapping, owner: string): StubMapping {
  assertValidStub(stub)
  const { uuid: _uuid, ...clean } = stub
  const ui = stub.metadata?.wiremockUi
  const tags = normaliseTags(ui?.tags)
  return {
    ...clean,
    metadata: { ...stub.metadata, wiremockUi: { integration: ui?.integration, endpoint: ui?.endpoint, ...(tags ? { tags } : {}), owner } },
  } as StubMapping
}

const ownerOf = (stub: StubMapping) => stub.metadata?.wiremockUi?.owner ?? 'baseline'

export class MockService {
  private wiremock: WireMockClient
  private store: MockStore
  private audit: AuditLog
  private now: () => Date
  private newId: () => string
  private storeIsWireMock: boolean

  constructor(deps: Deps) {
    this.storeIsWireMock = deps.storeIsWireMock ?? false
    this.wiremock = deps.wiremock
    this.store = deps.store
    this.audit = deps.audit
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  async create(input: MockInput, actor: PublicUser): Promise<StubMapping> {
    const stub = await this.save(this.newId(), input, 0, actor.username, null)
    await this.record({ actor: actor.username, action: 'mock.create', target: stub.id })
    return stub
  }

  /** A stub accepted from a recording's review list (spec A12): the normal create path, for `owner` (the user or baseline). */
  async createRecorded(input: MockInput, owner: string, actor: PublicUser): Promise<StubMapping> {
    this.validate(input)
    const stub = await this.save(this.newId(), input, 0, actor.username, null, { owner, version: 1, source: 'recording' })
    await this.record({ actor: actor.username, action: 'mock.create', target: stub.id, details: { source: 'recording' } })
    return stub
  }

  async update(
    id: string,
    input: MockInput,
    expectedVersion: number,
    actor: PublicUser,
  ): Promise<StubMapping> {
    this.validate(input)
    const previous = await this.get(id)
    if (previous.metadata?.wiremockUi?.version !== expectedVersion) throw new ConflictError()
    const stub = await this.save(id, input, expectedVersion, actor.username, previous)
    await this.record({ actor: actor.username, action: 'mock.update', target: id })
    return stub
  }

  async delete(id: string, expectedVersion: number | undefined, actor: PublicUser): Promise<void> {
    const current = await this.get(id)
    await this.remove(current, expectedVersion)
    await this.record({ actor: actor.username, action: 'mock.delete', target: id })
  }

  private async remove(current: StubMapping, expectedVersion: number | undefined): Promise<void> {
    const id = current.id
    if (expectedVersion !== undefined && current.metadata?.wiremockUi?.version !== expectedVersion) {
      throw new ConflictError()
    }
    if (this.storeIsWireMock) return this.store.delete(id, expectedVersion)
    await this.wiremock.deleteStub(id)
    try {
      await this.store.delete(id, expectedVersion)
    } catch (err) {
      try {
        const latest = (await this.store.get(id).catch(() => null)) ?? current
        await this.wiremock.importStubs([latest], { deleteAllNotInImport: false })
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr, id }, 'WireMock rollback failed')
      }
      throw err
    }
  }

  async get(id: string): Promise<StubMapping> {
    const stub = await this.store.get(id)
    if (!stub) throw new NotFoundError()
    return stub
  }

  /** `scenario`: a scenario's name, or `*` for every mock that belongs to a scenario. */
  async list(filter?: { integration?: string; owner?: string; status?: number; q?: string; scenario?: string; tag?: string }): Promise<StubMapping[]> {
    const all = await this.store.list({ integration: filter?.integration, owner: filter?.owner })
    const status = filter?.status
    const tag = filter?.tag
    const q = filter?.q?.trim().toLowerCase()
    const scenario = filter?.scenario
    return all
      .filter((stub) => {
        if (status !== undefined && (stub.response.status ?? 200) !== status) return false
        if (scenario !== undefined) {
          const name = typeof stub.scenarioName === 'string' ? stub.scenarioName : ''
          if (scenario === '*' ? name === '' : name !== scenario) return false
        }
        if (q && !matchesQuery(stub, q)) return false
        if (tag !== undefined && !tagsOf(stub).includes(tag)) return false
        return true
      })
      .sort(newestFirst)
  }

  /** Every tag in use with how many mocks carry it, most used first (ties by name). */
  async tags(): Promise<{ tag: string; count: number }[]> {
    const counts = new Map<string, number>()
    for (const stub of await this.store.listAll()) for (const tag of tagsOf(stub)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
  }

  /** One page of `list(filter)`; a scenario is one row (see `pageMocks`). */
  async listPage(filter: Parameters<MockService['list']>[0], page: { limit: number; offset: number }): Promise<MockPage> {
    return pageMocks(await this.list(filter), page)
  }

  async duplicate(id: string, actor: PublicUser): Promise<StubMapping> {
    const source = await this.get(id)
    const { id: _id, ...rest } = source
    const input = { ...rest, name: source.name ? `${source.name} (copy)` : '(copy)' } as MockInput
    const stub = await this.save(this.newId(), input, 0, actor.username, null)
    await this.record({ actor: actor.username, action: 'mock.duplicate', target: stub.id, details: { from: id } })
    return stub
  }

  async resetMine(actor: PublicUser): Promise<{ deleted: number }> {
    const mine = await this.store.list({ owner: actor.username })
    let deleted = 0
    try {
      for (const stub of mine) {
        await this.remove(stub, undefined)
        deleted++
      }
    } finally {
      await this.record({ actor: actor.username, action: 'mock.reset-mine', target: actor.username, details: { deleted } })
    }
    return { deleted }
  }

  /**
   * Import path: bypasses ownership (the caller decides what may be touched).
   * Same WireMock-first + rollback write as every other change; no write when nothing changed.
   */
  async upsertImported(
    stub: StubMapping,
    owner: string,
    source: ImportSource,
    actor: string,
  ): Promise<'created' | 'updated' | 'unchanged'> {
    const incoming = importedStub(stub, owner)
    const previous = await this.store.get(stub.id)
    if (previous && comparable(previous) === comparable(incoming)) return 'unchanged'
    const version = previous?.metadata?.wiremockUi?.version ?? 0
    await this.save(stub.id, incoming as MockInput, previous ? version : 0, actor, previous, {
      owner,
      version: version + 1,
      source,
    })
    return previous ? 'updated' : 'created'
  }

  /** What upsertImported would do with `stub`, without writing anything (the import review's dry run). */
  async importOutcome(stub: StubMapping, owner: string): Promise<'created' | 'updated' | 'unchanged'> {
    const incoming = importedStub(stub, owner)
    const previous = await this.store.get(stub.id)
    if (!previous) return 'created'
    return comparable(previous) === comparable(incoming) ? 'unchanged' : 'updated'
  }

  /** Import prune: removes a mock regardless of owner. */
  async deleteImported(id: string): Promise<void> {
    const current = await this.store.get(id)
    if (current) await this.remove(current, undefined)
  }

  history(id: string): Promise<StubMapping[]> {
    return this.store.history(id)
  }

  async restore(id: string, fromVersion: number, actor: PublicUser): Promise<StubMapping> {
    const versions = await this.store.history(id)
    const target = versions.find((v) => v.metadata?.wiremockUi?.version === fromVersion)
    if (!target) throw new NotFoundError('Version not found')
    const owner = ownerOf(target)
    const current = await this.store.get(id)
    let stub: StubMapping
    if (current) {
      stub = await this.save(id, target as MockInput, current.metadata?.wiremockUi?.version ?? 0, actor.username, current)
    } else {
      const highest = Math.max(...versions.map((v) => v.metadata?.wiremockUi?.version ?? 0))
      stub = await this.save(id, target as MockInput, 0, actor.username, null, { owner, version: highest + 1 })
    }
    await this.record({ actor: actor.username, action: 'mock.restore', target: id, details: { fromVersion } })
    return stub
  }

  private record(entry: { actor: string; action: string; target: string; details?: Record<string, unknown> }): Promise<void> {
    return safeRecord(this.audit, entry)
  }

  private validate(input: MockInput): void {
    if ('bodyFileName' in input.response) {
      throw new ValidationError('bodyFileName is not supported; put the body inline')
    }
    assertPowerFields(input as MockInput & Record<string, unknown>)
  }

  private async save(
    id: string,
    input: MockInput,
    expectedVersion: number,
    user: string,
    previous: StubMapping | null,
    override?: { owner: string; version: number; source?: CreateSource },
  ): Promise<StubMapping> {
    this.validate(input)
    const prevMeta = previous?.metadata?.wiremockUi
    const tags = normaliseTags(input.metadata?.wiremockUi?.tags)
    const wiremockUi: WireMockUiMeta = {
      integration: input.metadata?.wiremockUi?.integration,
      endpoint: input.metadata?.wiremockUi?.endpoint,
      ...(tags ? { tags } : {}),
      owner: override?.owner ?? prevMeta?.owner ?? user,
      version: override?.version ?? expectedVersion + 1,
      updatedAt: this.now().toISOString(),
      updatedBy: user,
      source: override?.source ?? 'ui',
    }
    // WireMock treats `id` and `uuid` as one field (last wins): a body value could retarget another stub.
    const { id: _id, uuid: _uuid, ...body } = input as MockInput & { id?: unknown; uuid?: unknown }
    const stub: StubMapping = normalisePowerFields({
      ...body,
      id,
      persistent: false,
      metadata: { ...input.metadata, wiremockUi },
    } as StubMapping)

    if (this.storeIsWireMock) {
      await this.store.save(stub, expectedVersion)
      // The store keeps a stub WireMock holds in its own files persistent: report what was stored.
      // The save went through: a failed read-back only loses that detail (the written stub is the answer).
      const stored = await this.store.get(id).catch((err: unknown) => {
        logger.warn({ err, id }, 'reading a saved mock back from WireMock failed')
        return null
      })
      return stored ? { ...stub, persistent: stored.persistent } : stub
    }
    await this.wiremock.importStubs([stub], { deleteAllNotInImport: false })
    try {
      await this.store.save(stub, expectedVersion)
    } catch (err) {
      await this.rollback(id, previous)
      throw err
    }
    return stub
  }

  private async rollback(id: string, previous: StubMapping | null): Promise<void> {
    try {
      if (!previous) {
        await this.wiremock.deleteStub(id)
        return
      }
      const current = (await this.store.get(id).catch(() => null)) ?? previous
      await this.wiremock.importStubs([current], { deleteAllNotInImport: false })
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr, id }, 'WireMock rollback failed')
    }
  }
}
