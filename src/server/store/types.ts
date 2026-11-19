import type { StubMapping } from '../wiremock/types'

export interface MockStore {
  get(id: string): Promise<StubMapping | null>
  /** Sorted by metadata.wiremockUi.updatedAt, newest first. */
  list(filter?: { integration?: string; owner?: string }): Promise<StubMapping[]>
  /** Every stub, any order. */
  listAll(): Promise<StubMapping[]>
  /** Writes stub. expectedVersion 0 = must not exist. Throws ConflictError if the stored version differs. */
  save(stub: StubMapping, expectedVersion: number): Promise<void>
  /** Throws ConflictError if expectedVersion is given and differs. Missing id resolves. */
  delete(id: string, expectedVersion?: number): Promise<void>
  /** Newest first. Still available after delete until it expires. */
  history(id: string): Promise<StubMapping[]>
  /** Returns a token, or null when the lock is held. */
  acquireLock(name: string, ttlMs: number): Promise<string | null>
  /** Releases only when the token matches. */
  releaseLock(name: string, token: string): Promise<void>
  ping(): Promise<boolean>
  close(): Promise<void>
}
