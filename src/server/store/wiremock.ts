import { randomUUID } from 'node:crypto'
import { ConflictError } from '../errors'
import { MARKER_ID } from '../sync/marker'
import type { WireMockClient } from '../wiremock/client'
import type { StubMapping, WireMockUiMeta } from '../wiremock/types'
import type { MockStore } from './types'

/** Owner shown for a stub WireMock holds without wiremock-ui metadata. */
export const WIREMOCK_OWNER = 'wiremock'

/**
 * A stub as the UI shows it: one made outside the UI (no `metadata.wiremockUi`) is presented as version 1
 * owned by `wiremock`, so it can be edited like any other mock.
 */
export function present(stub: StubMapping): StubMapping {
  const { uuid: _uuid, ...rest } = stub
  const ui = stub.metadata?.wiremockUi as Partial<WireMockUiMeta> | undefined
  const wiremockUi: WireMockUiMeta = {
    ...ui,
    owner: typeof ui?.owner === 'string' && ui.owner ? ui.owner : WIREMOCK_OWNER,
    version: typeof ui?.version === 'number' ? ui.version : 1,
    updatedAt: typeof ui?.updatedAt === 'string' ? ui.updatedAt : '',
    updatedBy: typeof ui?.updatedBy === 'string' ? ui.updatedBy : WIREMOCK_OWNER,
    source: ui?.source ?? 'wiremock',
  }
  return { ...rest, metadata: { ...stub.metadata, wiremockUi } }
}

// WireMock refuses (422) a lookup by anything but a UUID; such an id cannot name a stub.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const versionOf = (stub: StubMapping | null) => (stub ? (present(stub).metadata?.wiremockUi?.version ?? 1) : 0)

/**
 * WireMock-only mode (spec A10): WireMock's admin API is the store. Every call reads WireMock live (all
 * mappings, paged, for a list), filters and sorts in memory. The optimistic version check runs against the
 * live stub just before the write, so two saves racing between that read and the write both land (accepted).
 * No history, and locks are always granted (there is no sync to guard).
 */
export class WireMockMockStore implements MockStore {
  constructor(private readonly wiremock: WireMockClient) {}

  async get(id: string): Promise<StubMapping | null> {
    if (id === MARKER_ID || !UUID.test(id)) return null
    const stub = await this.wiremock.getStub(id)
    return stub ? present(stub) : null
  }

  async list(filter: { integration?: string; owner?: string } = {}): Promise<StubMapping[]> {
    const all = await this.listAll()
    const updatedAt = (s: StubMapping) => s.metadata?.wiremockUi?.updatedAt ?? ''
    return all
      .filter((s) => !filter.integration || s.metadata?.wiremockUi?.integration === filter.integration)
      .filter((s) => !filter.owner || s.metadata?.wiremockUi?.owner === filter.owner)
      .sort((a, b) => (updatedAt(a) < updatedAt(b) ? 1 : updatedAt(a) > updatedAt(b) ? -1 : 0))
  }

  async listAll(): Promise<StubMapping[]> {
    return (await this.wiremock.listStubs()).filter((s) => s.id !== MARKER_ID).map(present)
  }

  async save(stub: StubMapping, expectedVersion: number): Promise<void> {
    const live = await this.wiremock.getStub(stub.id)
    if ((expectedVersion === 0 && live) || versionOf(live) !== expectedVersion) throw new ConflictError()
    // A stub WireMock keeps in its own files stays there, so the edit survives a WireMock restart.
    const toWrite = live?.persistent === true ? { ...stub, persistent: true } : stub
    await this.wiremock.importStubs([toWrite], { deleteAllNotInImport: false })
  }

  async delete(id: string, expectedVersion?: number): Promise<void> {
    if (!UUID.test(id)) return
    const live = await this.wiremock.getStub(id)
    if (!live) return
    if (expectedVersion !== undefined && versionOf(live) !== expectedVersion) throw new ConflictError()
    await this.wiremock.deleteStub(id)
  }

  async history(_id: string): Promise<StubMapping[]> {
    return []
  }

  async acquireLock(_name: string, _ttlMs: number): Promise<string> {
    return randomUUID()
  }

  async releaseLock(_name: string, _token: string): Promise<void> {}

  /** Nothing to remember between runs in WireMock-only mode: flags are always off. */
  async getFlag(_name: string): Promise<boolean> {
    return false
  }

  async setFlag(_name: string, _on: boolean): Promise<void> {}

  ping(): Promise<boolean> {
    return this.wiremock.ping()
  }

  async close(): Promise<void> {}
}
