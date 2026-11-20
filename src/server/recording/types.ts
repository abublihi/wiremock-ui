import type { StubBase } from '../wiremock/types'

/** A recorded stub without an id (accepting it creates a new mock). */
export type ReviewStub = Omit<StubBase, 'id'> & Record<string, unknown>

/** How long a review list waits to be accepted before it is dropped (spec A12). */
export const RECORDING_TTL_MS = 24 * 60 * 60 * 1000
/** A recorded body above this is not kept: the row says "too large to review" and cannot be accepted. */
export const MAX_REVIEW_BODY_BYTES = 1024 * 1024
/** A review list holds at most this much (JSON); rows past it are left out and counted in `dropped`. */
export const MAX_REVIEW_LIST_BYTES = 20 * 1024 * 1024

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
  /** The body was over MAX_REVIEW_BODY_BYTES, so it was not kept: the row cannot be accepted. */
  tooLarge?: boolean
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
  /** Recorded mocks left out because the list was full (1000 rows or 20 MB). */
  dropped: number
  /** Recorded stubs WireMock still holds because removing them failed twice (they answer requests until removed). */
  leftInWireMock?: number
}

/** What `GET /api/recordings` lists: a review list without its rows. */
export type RecordingSummary = Omit<Recording, 'items'> & { itemCount: number }

export const summaryOf = ({ items, ...rest }: Recording): RecordingSummary => ({ ...rest, itemCount: items.length })

/** The recording WireMock is running, as started from this app (kept in the store, so every instance knows it). */
/** `filters`: what the recording was started with (as sent to WireMock), to explain an empty result on stop. */
export type ActiveRecording = { target: string; startedBy: string; startedAt: string; filters?: RecordingFilters }
/** The filters a recording or snapshot used, as WireMock got them. */
export type RecordingFilters = { method?: string; urlPathPattern?: string }

/** Review lists with an absolute expiry (`expiresAt`); expired lists read as missing on every driver. */
export interface RecordingStore {
  put(recording: Recording): Promise<void>
  get(id: string): Promise<Recording | null>
  /** Newest first. */
  list(): Promise<Recording[]>
  delete(id: string): Promise<void>
  getActive(): Promise<ActiveRecording | null>
  /** null clears it. */
  setActive(active: ActiveRecording | null): Promise<void>
}
