import { z } from 'zod'
import { safeRecord, type AuditLog } from '../audit/log'
import { buildStub, MIME, type SimpleMockInput } from '../catalog/build'
import type { CatalogService } from '../catalog/service'
import type { Endpoint, Integration } from '../catalog/types'
import type { Config } from '../config'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors'
import { logger } from '../logger'
import type { MockInput, MockService } from '../mocks/service'
import type { PublicUser } from '../users/types'
import type { WireMockClient } from '../wiremock/client'
import type { StubMapping } from '../wiremock/types'
import { reviewItem } from './normalise'
import { PATH_MODES, regexProblemMessage, resolvePathFilter } from './path-pattern'
import { isRecordingProxy } from './proxy'
import { renameRecordedScenarios } from './scenarios'
import { validateTarget } from './target'
import {
  MAX_REVIEW_BODY_BYTES,
  MAX_REVIEW_LIST_BYTES,
  RECORDING_TTL_MS,
  summaryOf,
  type Recording,
  type RecordingFilters,
  type RecordingStore,
  type RecordingSummary,
  type ReviewItem,
  type ReviewStub,
} from './types'
import type { MockStore } from '../store/types'

export const RECORDING_DISABLED = 'Recording is turned off on this environment (RECORDING_ALLOWED=false)'
/** A review list holds at most this many stubs; the rest are counted in `dropped`. */
export const MAX_REVIEW_ITEMS = 1000
const MAX_SNAPSHOT_IDS = 1000
/** Recorded stubs are removed from WireMock this many at a time (a snapshot of the whole log can be large). */
const DELETE_BATCH = 20
// Long enough for an accept of 1000 rows; the lock is released as soon as the work is done.
const LIST_LOCK_TTL_MS = 120_000
export const TOO_LARGE = 'This answer is over 1 MB, too large to review here, so it was not kept. Create this mock by hand or record a smaller response.'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'] as const
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

const filterFields = {
  /** Only requests with this method become mocks (all methods when left out). */
  method: z.enum(METHODS, { error: `method must be one of ${METHODS.join(', ')}` }).optional(),
  /**
   * Only requests whose path matches this become mocks: a wildcard pattern (`/api/*`; `*` is anything, a typed
   * `?query` is left out) or a regular expression over the whole path. `urlPathMode` says which; `auto` (the
   * default) reads it as a regex when it uses regex-only syntax (`.*`, `^`, `(`…), else as a wildcard.
   */
  urlPathPattern: z.string({ error: 'urlPathPattern must be a string' }).max(1024, 'urlPathPattern must be at most 1024 characters').optional(),
  urlPathMode: z.enum(PATH_MODES, { error: `urlPathMode must be one of ${PATH_MODES.join(', ')}` }).optional(),
  /** Request headers to match on (exactly as sent), besides method, URL and body. */
  captureHeaders: z
    .array(z.string({ error: 'captureHeaders must be header names' }).regex(HEADER_NAME, 'captureHeaders must be header names'), {
      error: 'captureHeaders must be a list of header names',
    })
    .max(20, 'captureHeaders takes at most 20 names')
    .optional(),
  /** Repeated identical requests with different responses become a scenario (default true). */
  repeatsAsScenarios: z.boolean({ error: 'repeatsAsScenarios must be true or false' }).optional(),
}

export const startSchema = z.strictObject(
  { targetUrl: z.string({ error: 'targetUrl must be a string' }).max(2048, 'targetUrl must be at most 2048 characters'), ...filterFields },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)
export const snapshotSchema = z.strictObject(
  {
    ...filterFields,
    /** Request log entries to take (their ids); all entries when left out. */
    ids: z
      .array(z.string({ error: 'ids must be request ids' }).min(1).max(64), { error: 'ids must be a list of request ids' })
      .min(1, 'ids must not be empty')
      .max(MAX_SNAPSHOT_IDS, `ids takes at most ${MAX_SNAPSHOT_IDS} requests`)
      .optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)
const keyField = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'keys must be 1–63 characters: a-z, 0-9 or -')
export const acceptSchema = z.strictObject(
  {
    items: z
      .array(
        z.strictObject({
          id: z.string({ error: 'items.id must be a string' }),
          name: z.string({ error: 'items.name must be a string' }).optional(),
          integration: keyField.optional(),
          endpoint: keyField.optional(),
          /** Create this endpoint from the recorded request first. */
          newEndpoint: z.strictObject({ key: keyField, name: z.string().min(1, 'newEndpoint.name must not be empty') }).optional(),
        }),
        { error: 'items must be a list' },
      )
      .min(1, 'Select at least one mock to accept')
      .max(MAX_REVIEW_ITEMS),
    /** `me` (default): the accepting user owns the mocks; `baseline`: shared baseline mocks. */
    owner: z.enum(['me', 'baseline'], { error: 'owner must be me or baseline' }).optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? `unknown field: ${iss.keys.join(', ')}` : 'body must be an object') },
)
export const discardSchema = z.strictObject(
  { ids: z.array(z.string(), { error: 'ids must be a list' }).min(1, 'Select at least one mock to discard').max(MAX_REVIEW_ITEMS) },
  { error: 'body must be an object' },
)

export type StartInput = z.infer<typeof startSchema>
export type SnapshotInput = z.infer<typeof snapshotSchema>
export type AcceptInput = z.infer<typeof acceptSchema>

/**
 * Why a stop or snapshot produced no review list. `filtered`: requests went through (the recording proxy, or the
 * request log for a snapshot) but none passed the filters. `noTraffic`: nothing reached WireMock.
 */
export type EmptyResult =
  | { reason: 'filtered'; requests: number; filters: RecordingFilters }
  | { reason: 'noTraffic'; wiremockUrl: string }

export type RecordResult = { recording: Recording | null; empty?: EmptyResult }

/** What the banner and the Recording page show. `target` is known even for a recording started outside the UI. */
export type RecordingState =
  | { status: 'recording'; target: string | null; startedBy: string | null; startedAt: string | null }
  | { status: 'idle' }

export type AcceptResult = {
  created: { id: string; mockId: string }[]
  failed: { id: string; error: string }[]
  /** The review list with the accepted items gone; null once it is empty (and deleted). */
  recording: Recording | null
}

type Deps = {
  wiremock: WireMockClient
  store: RecordingStore
  /** For the short lock around accept and discard (any driver). */
  locks: Pick<MockStore, 'acquireLock' | 'releaseLock'>
  mocks: MockService
  catalog: CatalogService
  audit: AuditLog
  config: Pick<Config, 'recordingAllowed' | 'wiremockUrl' | 'wiremockPublicUrl' | 'publicUiUrl'>
  now?: () => Date
  newId?: () => string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const onlyKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k))

/** The WireMock record/snapshot spec shared by both: never persisted, bodies always inline (no extractBodyCriteria). */
function recordSpec(input: Omit<SnapshotInput, 'ids'>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (input.method) filters.method = input.method
  const pattern = input.urlPathPattern?.trim()
  if (pattern) {
    const path = resolvePathFilter(pattern, input.urlPathMode)
    if (path.kind === 'regex') {
      try {
        new RegExp(path.regex)
      } catch {
        throw new ValidationError('urlPathPattern is not a valid regular expression')
      }
      if (path.problem) throw new ValidationError(regexProblemMessage(path.problem, pattern))
    }
    filters.urlPathPattern = path.regex
  }
  return {
    persist: false,
    repeatsAsScenarios: input.repeatsAsScenarios ?? true,
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(input.captureHeaders && input.captureHeaders.length > 0
      ? { captureHeaders: Object.fromEntries(input.captureHeaders.map((h) => [h, {}])) }
      : {}),
  }
}

const pathOf = (stub: ReviewStub) =>
  typeof stub.request.urlPath === 'string' ? stub.request.urlPath : String(stub.request.url ?? '/').split('?')[0]

const contentTypeOf = (type: string | undefined): Endpoint['contentType'] =>
  !type ? 'text' : /[/+]json/i.test(type) ? 'json' : /[/+]xml/i.test(type) ? 'xml' : /html/i.test(type) ? 'html' : 'text'

/** A row whose body is over the cap: the body is not kept, the row says so and cannot be accepted. */
function withoutBody(item: ReviewItem): ReviewItem {
  const { body: _b, jsonBody: _j, base64Body: _6, ...response } = item.stub.response
  return { ...item, stub: { ...item.stub, response }, tooLarge: true }
}

export class RecordingService {
  private readonly busy = new Set<string>()
  private readonly now: () => Date
  private readonly newId: () => string

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date())
    this.newId = deps.newId ?? (() => crypto.randomUUID())
  }

  get allowed(): boolean {
    return this.deps.config.recordingAllowed
  }

  assertAllowed(): void {
    if (!this.allowed) throw new AppError(RECORDING_DISABLED, 403)
  }

  async state(): Promise<RecordingState> {
    if ((await this.deps.wiremock.recordingStatus()) !== 'Recording') {
      if (await this.deps.store.getActive()) await this.deps.store.setActive(null)
      return { status: 'idle' }
    }
    // Kept in the store, so every instance knows who started it.
    const active = await this.deps.store.getActive()
    if (active) return { status: 'recording', ...active }
    // Started outside the UI: the proxy stub WireMock added still names the target.
    const proxy = (await this.deps.wiremock.listStubs()).find(isRecordingProxy)
    return { status: 'recording', target: (proxy?.response.proxyBaseUrl as string | undefined) ?? null, startedBy: null, startedAt: null }
  }

  /** `appUrls`: where this app is reached (the request's origin, its own port on WireMock's machine), refused as targets. */
  async start(input: StartInput, actor: string, appUrls: string[]): Promise<RecordingState> {
    this.assertAllowed()
    const { config } = this.deps
    const target = validateTarget(input.targetUrl, {
      wiremock: [config.wiremockUrl, config.wiremockPublicUrl],
      app: [...appUrls, ...(config.publicUiUrl ? [config.publicUiUrl] : [])],
    })
    const spec = recordSpec(input)
    if ((await this.deps.wiremock.recordingStatus()) === 'Recording') {
      throw new ConflictError('A recording is already running. Stop it before starting another one.')
    }
    await this.deps.wiremock.startRecording({ targetBaseUrl: target, ...spec })
    const filters = (spec.filters ?? {}) as RecordingFilters
    // The proxy stub WireMock just added: the requests it serves are the ones that went through this recording.
    const proxyStubId = await this.deps.wiremock
      .listStubs()
      .then((stubs) => stubs.find(isRecordingProxy)?.id)
      .catch(() => undefined)
    const active = { target, startedBy: actor, startedAt: this.now().toISOString(), filters, ...(proxyStubId ? { proxyStubId } : {}) }
    await this.deps.store.setActive(active)
    await safeRecord(this.deps.audit, { actor, action: 'recording.start', details: { target } })
    return { status: 'recording', target, startedBy: actor, startedAt: active.startedAt }
  }

  /** Stops recording; the stubs go into a new review list (null when nothing was recorded). */
  async stop(actor: string): Promise<RecordResult> {
    this.assertAllowed()
    const current = await this.state()
    const target = (current.status === 'recording' ? current.target : null) ?? undefined
    const active = await this.deps.store.getActive()
    const stubs = await this.deps.wiremock.stopRecording()
    await this.deps.store.setActive(null)
    if (stubs === null) throw new ConflictError('No recording is running')
    const recording = await this.keepAndRemove('recording', stubs, actor, target)
    await safeRecord(this.deps.audit, {
      actor,
      action: 'recording.stop',
      target: recording?.id,
      details: { target, recorded: stubs.length, ...(recording?.leftInWireMock ? { leftInWireMock: recording.leftInWireMock } : {}) },
    })
    if (recording) return { recording }
    // Nothing recorded: did requests go through this recording's proxy stub (filters too narrow), or did none arrive?
    // Matched by stub id, not by time: WireMock's clock and ours may differ. Started outside the UI: any recording proxy.
    const viaProxy = (stub: StubMapping | undefined) =>
      stub !== undefined && (active?.proxyStubId ? stub.id === active.proxyStubId : isRecordingProxy(stub))
    const proxied = (await this.journal()).filter((e) => viaProxy(e.stubMapping)).length
    return { recording: null, empty: this.emptyResult(proxied, active?.filters ?? {}) }
  }

  private emptyResult(requests: number, filters: RecordingFilters): EmptyResult {
    return requests > 0
      ? { reason: 'filtered', requests, filters }
      : { reason: 'noTraffic', wiremockUrl: this.deps.config.wiremockPublicUrl ?? this.deps.config.wiremockUrl }
  }

  /** The newest 1000 entries of the request log; a failure counts as empty. */
  private async journal() {
    try {
      return await this.deps.wiremock.listRequests({ limit: 1000 })
    } catch (err) {
      logger.warn({ err }, 'could not read the request log to explain an empty recording')
      return []
    }
  }

  /** Turns request log entries into a review list (null when none matched). */
  async snapshot(input: SnapshotInput, actor: string): Promise<RecordResult> {
    this.assertAllowed()
    const spec = recordSpec(input)
    const filters = { ...(spec.filters as Record<string, unknown> | undefined), allowNonProxied: true, ...(input.ids ? { ids: input.ids } : {}) }
    const stubs = await this.deps.wiremock.snapshotRecording({ ...spec, filters })
    const recording = await this.keepAndRemove('snapshot', stubs, actor)
    await safeRecord(this.deps.audit, {
      actor,
      action: 'recording.snapshot',
      target: recording?.id,
      details: { recorded: stubs.length, ...(recording?.leftInWireMock ? { leftInWireMock: recording.leftInWireMock } : {}) },
    })
    if (recording) return { recording }
    // Nothing taken: was the request log empty (or the picked requests gone), or did the filters leave everything out?
    const journal = await this.journal()
    const picked = input.ids ? new Set(input.ids) : null
    const requests = journal.filter((e) => !picked || picked.has(e.id)).length
    return { recording: null, empty: this.emptyResult(requests, (spec.filters ?? {}) as RecordingFilters) }
  }

  /**
   * The review list is saved first, so the recorded stubs are never only in WireMock's hands; then they are
   * removed from WireMock (WireMock added them although persist was false). Whatever survives two tries is
   * counted in `leftInWireMock` and logged by id.
   */
  private async keepAndRemove(kind: Recording['kind'], stubs: StubMapping[], actor: string, target?: string): Promise<Recording | null> {
    if (stubs.length === 0) return null
    const recording = await this.keep(kind, stubs, actor, target)
    const left = await this.removeFromWireMock(stubs.map((s) => s.id))
    if (left.length === 0) return recording
    logger.error({ ids: left, recording: recording.id }, 'recorded stubs could not be removed from WireMock; they answer requests until deleted')
    const updated = { ...recording, leftInWireMock: left.length }
    await this.deps.store.put(updated)
    return updated
  }

  /** Summaries only: the rows load with get(). */
  async list(): Promise<RecordingSummary[]> {
    this.assertAllowed()
    return (await this.deps.store.list()).map(summaryOf)
  }

  /** Runs `fn` holding the review list's lock, so two accepts (or an accept and a discard) never overlap. */
  private async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const busy = new ConflictError('Someone is changing this review list right now. Try again in a moment.')
    // In this process too: WireMock-only mode's store grants every lock (it has no sync to guard).
    if (this.busy.has(id)) throw busy
    this.busy.add(id)
    const name = `lock:recording:${id}`
    let token: string | null = null
    try {
      token = await this.deps.locks.acquireLock(name, LIST_LOCK_TTL_MS)
      if (token === null) throw busy
      return await fn()
    } finally {
      this.busy.delete(id)
      if (token !== null) {
        const held = token
        await this.deps.locks.releaseLock(name, held).catch((err) => logger.warn({ err }, 'recording lock release failed'))
      }
    }
  }

  async get(id: string): Promise<Recording> {
    this.assertAllowed()
    const recording = await this.deps.store.get(id)
    if (!recording) throw new NotFoundError('Review list not found: it was accepted, discarded or expired after 24 hours')
    return recording
  }

  /** Drops the given items, or the whole list when `ids` is undefined. Returns what is left (null when nothing). */
  async discard(id: string, ids: string[] | undefined, actor: string): Promise<Recording | null> {
    await this.get(id)
    return this.locked(id, () => this.discardLocked(id, ids, actor))
  }

  private async discardLocked(id: string, ids: string[] | undefined, actor: string): Promise<Recording | null> {
    const recording = await this.get(id)
    const drop = ids ? new Set(ids) : null
    const left = drop ? recording.items.filter((i) => !drop.has(i.id)) : []
    const discarded = recording.items.length - left.length
    const result = await this.save({ ...recording, items: left })
    await safeRecord(this.deps.audit, { actor, action: 'recording.discard', target: id, details: { discarded } })
    return result
  }

  /** Creates a mock per item through the normal create path; accepted items leave the review list. */
  async accept(id: string, input: AcceptInput, actor: PublicUser): Promise<AcceptResult> {
    await this.get(id)
    return this.locked(id, () => this.acceptLocked(id, input, actor))
  }

  private async acceptLocked(id: string, input: AcceptInput, actor: PublicUser): Promise<AcceptResult> {
    // Read again under the lock: rows another accept took are gone.
    const recording = await this.get(id)
    const byId = new Map(recording.items.map((i) => [i.id, i]))
    const owner = input.owner === 'baseline' ? 'baseline' : actor.username
    const created: AcceptResult['created'] = []
    const failed: AcceptResult['failed'] = []
    for (const choice of input.items) {
      const item = byId.get(choice.id)
      if (!item) {
        failed.push({ id: choice.id, error: 'Not in this review list (accepted or discarded already)' })
        continue
      }
      if (item.tooLarge) {
        failed.push({ id: item.id, error: TOO_LARGE })
        continue
      }
      try {
        const stub = await this.stubFor(item, choice, actor.username)
        const mock = await this.deps.mocks.createRecorded(stub, owner, actor)
        created.push({ id: item.id, mockId: mock.id })
        byId.delete(item.id)
      } catch (err) {
        if (!(err instanceof AppError)) logger.error({ err, item: item.id }, 'accepting a recorded mock failed')
        failed.push({ id: item.id, error: err instanceof AppError ? err.message : 'Internal error' })
      }
    }
    const left = recording.items.filter((i) => byId.has(i.id))
    const result = await this.save({ ...recording, items: left })
    await safeRecord(this.deps.audit, {
      actor: actor.username,
      action: 'recording.accept',
      target: id,
      details: { accepted: created.length, failed: failed.length, owner },
    })
    return { created, failed, recording: result }
  }

  /** The mock to create for one item: the Simple form's endpoint shape when it fits, else the quick shape (+ link). */
  private async stubFor(item: ReviewItem, choice: AcceptInput['items'][number], actor: string): Promise<MockInput> {
    const name = choice.name?.trim()
    if (choice.name !== undefined && !name) throw new ValidationError('Name must not be empty')
    const quick = { ...structuredClone(item.stub), ...(name ? { name } : {}) } as MockInput
    if (!choice.integration) {
      if (choice.endpoint || choice.newEndpoint) throw new ValidationError('Pick an integration for the endpoint')
      return quick
    }
    const integration = await this.deps.catalog.getIntegration(choice.integration)
    let endpoint: Endpoint | null = null
    if (choice.newEndpoint) endpoint = await this.createEndpoint(item, integration, choice.newEndpoint, actor)
    else if (choice.endpoint) endpoint = await this.deps.catalog.getEndpoint(integration.key, choice.endpoint)
    const link = { integration: integration.key, ...(endpoint ? { endpoint: endpoint.key } : {}) }
    if (endpoint) {
      const simple = this.endpointStub(item, integration, endpoint, name)
      if (simple) return simple
    }
    return { ...quick, metadata: { wiremockUi: link } }
  }

  /** An endpoint for the recorded request: its method and exact path under the integration prefix, its body as the example. */
  private async createEndpoint(item: ReviewItem, integration: Integration, input: { key: string; name: string }, actor: string): Promise<Endpoint> {
    const path = pathOf(item.stub)
    const prefix = integration.prefix
    let relative: string
    if (prefix === '/') relative = path
    else if (path.startsWith(`${prefix}/`)) relative = path.slice(prefix.length)
    else throw new ValidationError(`The request path ${path} is not under the integration prefix ${prefix}; pick another integration`)
    const contentType = contentTypeOf(item.contentType)
    const res = item.stub.response
    // A JSON endpoint only takes JSON examples: a text body under a JSON type is left out.
    const example =
      res.jsonBody !== undefined ? JSON.stringify(res.jsonBody, null, 2) : typeof res.body === 'string' && contentType !== 'json' ? res.body : undefined
    return this.deps.catalog.upsertEndpoint(
      {
        integration: integration.key,
        key: input.key,
        name: input.name.trim(),
        method: item.method,
        path: relative,
        pathType: 'exact',
        contentType,
        exampleResponses: example !== undefined && item.status !== null ? { [String(item.status)]: example } : {},
        allowedStatuses: [],
      },
      actor,
      { createOnly: true },
    )
  }

  /** The Simple editor's default mock for `endpoint`, when the recorded stub says exactly that; null otherwise. */
  private endpointStub(item: ReviewItem, integration: Integration, endpoint: Endpoint, name: string | undefined): MockInput | null {
    const { stub } = item
    const root = integration.prefix === '/' ? '' : integration.prefix
    const { request, response } = stub
    if (endpoint.pathType !== 'exact' || !onlyKeys(request, ['method', 'urlPath'])) return null
    if (request.method !== endpoint.method || request.urlPath !== root + endpoint.path) return null
    if (!onlyKeys(stub, ['name', 'request', 'response', 'scenarioName', 'requiredScenarioState', 'newScenarioState'])) return null
    if (!onlyKeys(response, ['status', 'headers', 'body', 'jsonBody']) || typeof response.status !== 'number') return null
    const headers = response.headers
    if (!isRecord(headers) || !onlyKeys(headers, ['Content-Type']) || headers['Content-Type'] !== MIME[endpoint.contentType]) return null
    if (endpoint.allowedStatuses.length > 0 && !endpoint.allowedStatuses.includes(response.status)) return null
    const json = endpoint.contentType === 'json'
    if (json ? response.body !== undefined : response.jsonBody !== undefined) return null
    const input: SimpleMockInput = { isDefault: true, status: response.status, name: name ?? (stub.name as string) }
    if (json && response.jsonBody !== undefined) input.body = JSON.stringify(response.jsonBody, null, 2)
    if (!json && typeof response.body === 'string') input.body = response.body
    if (typeof stub.scenarioName === 'string' && typeof stub.requiredScenarioState === 'string') {
      input.scenario = {
        name: stub.scenarioName,
        requiredState: stub.requiredScenarioState,
        ...(typeof stub.newScenarioState === 'string' ? { newState: stub.newScenarioState } : {}),
      }
    } else if (stub.scenarioName !== undefined) return null
    return buildStub(integration, endpoint, input)
  }

  /** Deletes in batches of DELETE_BATCH, then retries the failures once; returns the ids still in WireMock. */
  private async removeFromWireMock(ids: string[]): Promise<string[]> {
    const attempt = async (batch: string[]) => {
      const failed: string[] = []
      for (let i = 0; i < batch.length; i += DELETE_BATCH) {
        const slice = batch.slice(i, i + DELETE_BATCH)
        const results = await Promise.allSettled(slice.map((id) => this.deps.wiremock.deleteStub(id)))
        results.forEach((r, n) => r.status === 'rejected' && failed.push(slice[n]))
      }
      return failed
    }
    const failed = await attempt(ids)
    return failed.length === 0 ? [] : attempt(failed)
  }

  private async keep(kind: Recording['kind'], stubs: StubMapping[], actor: string, target?: string): Promise<Recording> {
    // The recorded stubs are still in WireMock (and so in WireMock-only mode's mock list): they are not "existing".
    const recordedIds = new Set(stubs.map((s) => s.id))
    const existing = (await this.deps.mocks.list()).filter((m) => !recordedIds.has(m.id))
    const ids = new Map(existing.map((m) => [m.id, m]))
    const now = this.now()
    const named = stubs.map((stub): ReviewItem => {
      const { matchedStubId, ...normalised } = reviewItem(stub)
      const item = normalised.bodySize > MAX_REVIEW_BODY_BYTES ? withoutBody(normalised) : normalised
      const path = item.url.split('?')[0]
      const same =
        (matchedStubId ? ids.get(matchedStubId) : undefined) ??
        existing.find(
          (m) =>
            (m.request.method === item.method || m.request.method === 'ANY') &&
            (m.request.url === item.url || m.request.urlPath === path || m.request.url === path),
        )
      // WireMock's answer to a request no stub matched: a bare 404 without a Matched-Stub-Id.
      const unmatched = kind === 'snapshot' && !matchedStubId && item.status === 404 && item.bodySize === 0
      return {
        ...item,
        ...(same ? { duplicateOf: { id: same.id, ...(same.name ? { name: same.name } : {}) } } : {}),
        ...(unmatched ? { unmatched: true } : {}),
      }
    })
    // Scenario names unique across mocks and review lists, so accepting two recordings never merges their chains.
    const taken = new Set<string>()
    for (const m of existing) if (typeof m.scenarioName === 'string') taken.add(m.scenarioName)
    for (const r of await this.deps.store.list()) for (const i of r.items) if (typeof i.stub.scenarioName === 'string') taken.add(i.stub.scenarioName)
    const all = renameRecordedScenarios(named, taken, now)
    // At most MAX_REVIEW_ITEMS rows and MAX_REVIEW_LIST_BYTES of JSON; the rest is counted in `dropped`.
    const items: ReviewItem[] = []
    let bytes = 0
    for (const item of all) {
      const size = Buffer.byteLength(JSON.stringify(item))
      if (items.length >= MAX_REVIEW_ITEMS || bytes + size > MAX_REVIEW_LIST_BYTES) continue
      items.push(item)
      bytes += size
    }
    const recording: Recording = {
      id: this.newId(),
      kind,
      ...(target ? { target } : {}),
      createdAt: now.toISOString(),
      createdBy: actor,
      expiresAt: new Date(now.getTime() + RECORDING_TTL_MS).toISOString(),
      items,
      dropped: all.length - items.length,
    }
    await this.deps.store.put(recording)
    return recording
  }

  private async save(recording: Recording): Promise<Recording | null> {
    if (recording.items.length === 0) {
      await this.deps.store.delete(recording.id)
      return null
    }
    await this.deps.store.put(recording)
    return recording
  }
}
