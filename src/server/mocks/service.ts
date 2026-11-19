import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { logger } from '../logger'
import type { MockStore } from '../store/types'
import type { WireMockClient } from '../wiremock/client'
import type { StubMapping, WireMockUiMeta } from '../wiremock/types'

export type MockInput = Omit<StubMapping, 'id' | 'metadata'> & {
  metadata?: { wiremockUi?: Partial<Pick<WireMockUiMeta, 'integration' | 'endpoint'>> } & Record<
    string,
    unknown
  >
}

type Deps = {
  wiremock: WireMockClient
  store: MockStore
  now?: () => Date
  newId?: () => string
}

export class MockService {
  private wiremock: WireMockClient
  private store: MockStore
  private now: () => Date
  private newId: () => string

  constructor(deps: Deps) {
    this.wiremock = deps.wiremock
    this.store = deps.store
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  create(input: MockInput, user: string): Promise<StubMapping> {
    return this.save(this.newId(), input, 0, user, null)
  }

  async update(
    id: string,
    input: MockInput,
    expectedVersion: number,
    user: string,
  ): Promise<StubMapping> {
    this.validate(input)
    const previous = await this.get(id)
    if (previous.metadata?.wiremockUi?.version !== expectedVersion) throw new ConflictError()
    return this.save(id, input, expectedVersion, user, previous)
  }

  // `user` is reserved for the audit log (later milestone).
  async delete(id: string, expectedVersion: number | undefined, _user: string): Promise<void> {
    const current = await this.get(id)
    if (expectedVersion !== undefined && current.metadata?.wiremockUi?.version !== expectedVersion) {
      throw new ConflictError()
    }
    await this.wiremock.deleteStub(id)
    await this.store.delete(id, expectedVersion)
  }

  async get(id: string): Promise<StubMapping> {
    const stub = await this.store.get(id)
    if (!stub) throw new NotFoundError()
    return stub
  }

  list(filter?: { integration?: string; owner?: string }): Promise<StubMapping[]> {
    return this.store.list(filter)
  }

  private validate(input: MockInput): void {
    const response = input.response as Record<string, unknown> | undefined
    if (response && 'bodyFileName' in response) {
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
    const stub = {
      ...input,
      id,
      persistent: false,
      metadata: { ...input.metadata, wiremockUi },
    } as StubMapping

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
