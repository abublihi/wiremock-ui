import type { StubBase } from '../wiremock/types'

/** A recorded stub without an id (accepting it creates a new mock). */
export type ReviewStub = Omit<StubBase, 'id'> & Record<string, unknown>

/** How long a review list waits to be accepted before it is dropped (spec A12). */
export const RECORDING_TTL_MS = 24 * 60 * 60 * 1000

/** One recorded stub waiting in a review list. `stub` has no id: accepting it creates a new mock. */
export type ReviewItem = {
  /** Stable within the review list (WireMock's id for the recorded stub). */
  id: string
  stub: ReviewStub
  method: string
  /** The recorded path with its query string. */
  url: string
  /** null for a fault. */
  status: number | null
  /** Response body size in bytes. */
  bodySize: number
  contentType?: string
  /** An existing mock that already answers this request. */
  duplicateOf?: { id: string; name?: string }
  /** Snapshot only: no mock answered this request (WireMock's bare 404), so it is rarely worth keeping. */
  unmatched?: boolean
}

/** A review list: the stubs one recording or snapshot produced. Nothing in it is a mock until accepted. */
export type Recording = {
  id: string
  kind: 'recording' | 'snapshot'
  /** The target base URL (recordings only). */
  target?: string
  createdAt: string
  createdBy: string
  expiresAt: string
  items: ReviewItem[]
  /** Stubs left out because the list was full. */
  dropped: number
}

/** Review lists with an absolute expiry (`expiresAt`); expired lists read as missing on every driver. */
export interface RecordingStore {
  put(recording: Recording): Promise<void>
  get(id: string): Promise<Recording | null>
  /** Newest first. */
  list(): Promise<Recording[]>
  delete(id: string): Promise<void>
}
