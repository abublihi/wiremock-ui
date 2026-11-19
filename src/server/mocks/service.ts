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
    await this.audit.record({ actor: actor.username, action: 'mock.create', target: stub.id })
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
    await this.audit.record({ actor: actor.username, action: 'mock.update', target: id })
    return stub
  }

  async delete(id: string, expectedVersion: number | undefined, actor: PublicUser): Promise<void> {
    const current = await this.get(id)
    this.assertCanEdit(actor, ownerOf(current))
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
    await this.audit.record({ actor: actor.username, action: 'mock.delete', target: id })
  }

  async get(id: string): Promise<StubMapping> {
    const stub = await this.store.get(id)
    if (!stub) throw new NotFoundError()
    return stub
  }

  list(filter?: { integration?: string; owner?: string }): Promise<StubMapping[]> {
    return this.store.list(filter)
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
  ): Promise<StubMapping> {
    this.validate(input)
    const prevMeta = previous?.metadata?.wiremockUi
    const wiremockUi: WireMockUiMeta = {
      integration: input.metadata?.wiremockUi?.integration,
      endpoint: input.metadata?.wiremockUi?.endpoint,
      owner: prevMeta?.owner ?? user,
      version: expectedVersion + 1,
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
