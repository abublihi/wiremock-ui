import type { AuditLog } from '../audit/log'
import { canEditMock } from '../auth/permissions'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors'
import { logger } from '../logger'
import type { MockStore } from '../store/types'
import type { PublicUser } from '../users/types'
import type { WireMockClient } from '../wiremock/client'
import type { StubBase, StubMapping, WireMockUiMeta } from '../wiremock/types'

export type MockInput = Omit<StubBase, 'id' | 'metadata'> & {
  metadata?: { wiremockUi?: Partial<Pick<WireMockUiMeta, 'integration' | 'endpoint'>> } & Record<
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

const ownerOf = (stub: StubMapping) => stub.metadata?.wiremockUi?.owner ?? 'baseline'

export class MockService {
  private wiremock: WireMockClient
  private store: MockStore
  private audit: AuditLog
  private now: () => Date
  private newId: () => string

  constructor(deps: Deps) {
    this.wiremock = deps.wiremock
    this.store = deps.store
    this.audit = deps.audit
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  async create(input: MockInput, actor: PublicUser): Promise<StubMapping> {
    this.assertCanEdit(actor, actor.username)
    const stub = await this.save(this.newId(), input, 0, actor.username, null)
    await this.record({ actor: actor.username, action: 'mock.create', target: stub.id })
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
    this.assertCanEdit(actor, ownerOf(previous))
    if (previous.metadata?.wiremockUi?.version !== expectedVersion) throw new ConflictError()
    const stub = await this.save(id, input, expectedVersion, actor.username, previous)
    await this.record({ actor: actor.username, action: 'mock.update', target: id })
    return stub
  }

  async delete(id: string, expectedVersion: number | undefined, actor: PublicUser): Promise<void> {
    const current = await this.get(id)
    this.assertCanEdit(actor, ownerOf(current))
    await this.remove(current, expectedVersion)
    await this.record({ actor: actor.username, action: 'mock.delete', target: id })
  }

  private async remove(current: StubMapping, expectedVersion: number | undefined): Promise<void> {
    const id = current.id
    if (expectedVersion !== undefined && current.metadata?.wiremockUi?.version !== expectedVersion) {
      throw new ConflictError()
    }
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

  async list(filter?: { integration?: string; owner?: string; status?: number; q?: string }): Promise<StubMapping[]> {
    const all = await this.store.list({ integration: filter?.integration, owner: filter?.owner })
    const status = filter?.status
    const q = filter?.q?.trim().toLowerCase()
    return all.filter((stub) => {
      if (status !== undefined && (stub.response.status ?? 200) !== status) return false
      if (q && !matchesQuery(stub, q)) return false
      return true
    })
  }

  async duplicate(id: string, actor: PublicUser): Promise<StubMapping> {
    this.assertCanEdit(actor, actor.username)
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

  history(id: string): Promise<StubMapping[]> {
    return this.store.history(id)
  }

  async restore(id: string, fromVersion: number, actor: PublicUser): Promise<StubMapping> {
    const versions = await this.store.history(id)
    const target = versions.find((v) => v.metadata?.wiremockUi?.version === fromVersion)
    if (!target) throw new NotFoundError('Version not found')
    const owner = ownerOf(target)
    this.assertCanEdit(actor, owner)
    const current = await this.store.get(id)
    if (current) this.assertCanEdit(actor, ownerOf(current))
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

  // The write already committed; a failing audit log must not turn it into an error.
  private async record(entry: {
    actor: string
    action: string
    target: string
    details?: Record<string, unknown>
  }): Promise<void> {
    try {
      await this.audit.record(entry)
    } catch (err) {
      logger.error({ err, ...entry }, 'audit record failed')
    }
  }

  private assertCanEdit(actor: PublicUser, owner: string): void {
    if (!canEditMock(actor, owner)) throw new AppError('Forbidden', 403)
  }

  private validate(input: MockInput): void {
    if ('bodyFileName' in input.response) {
      throw new ValidationError('bodyFileName is not supported; put the body inline')
    }
  }

  private async save(
    id: string,
    input: MockInput,
    expectedVersion: number,
    user: string,
    previous: StubMapping | null,
    override?: { owner: string; version: number },
  ): Promise<StubMapping> {
    this.validate(input)
    const prevMeta = previous?.metadata?.wiremockUi
    const wiremockUi: WireMockUiMeta = {
      integration: input.metadata?.wiremockUi?.integration,
      endpoint: input.metadata?.wiremockUi?.endpoint,
      owner: override?.owner ?? prevMeta?.owner ?? user,
      version: override?.version ?? expectedVersion + 1,
      updatedAt: this.now().toISOString(),
      updatedBy: user,
      source: 'ui',
    }
    const stub: StubMapping = {
      ...input,
      id,
      persistent: false,
      metadata: { ...input.metadata, wiremockUi },
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
