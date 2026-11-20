import { useSyncExternalStore } from 'react'
import { keepPreviousData, queryOptions, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useT } from '@/ui/i18n'
import type { QuickMockInput, SimpleMockInput } from '@/server/catalog/build'
import type { AuditPage } from '@/server/audit/log'
import type { ImportReport } from '@/server/bundle/importer'
import type { PublicConfig } from '@/server/http/handlers/config'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { MockPage } from '@/server/mocks/paging'
import type { PublicUser } from '@/server/users/types'
import type { NearMissView, RequestSummary } from '@/server/requests/journal'
import type { TestRequestInput, TestRequestResult } from '@/server/wiremock/relay'
import type { Scenario } from '@/server/scenarios/service'
import type { AcceptResult, RecordingState, SnapshotInput, StartInput } from '@/server/recording/service'
import type { Recording } from '@/server/recording/types'
import type { AcceptItem } from '@/ui/lib/recording'
import type { LoggedEvent, StubMapping } from '@/server/wiremock/types'
import { SESSION_KEY, apiFetch, type SessionData } from './client'

export type RequestFilter = {
  matched?: 'true' | 'false'
  integration?: string
  status?: string
  q?: string
  /** Only requests from the last N minutes. */
  windowMinutes?: number
}
/** `scenario`: one scenario's mocks, or `*` for every mock that belongs to a scenario. */
export type MockFilter = { owner?: string; integration?: string; status?: string; q?: string; scenario?: string }

/** One page of the mocks list: `limit` rows (a scenario is one row) from row `offset`. */
export type MockPageArgs = { limit: number; offset: number }

/** Single source for every query key. Later tasks add their resources here. */
export const queryKeys = {
  session: SESSION_KEY,
  config: ['config'] as const,
  mocks: ['mocks'] as const,
  mockList: (filter: MockFilter) => ['mocks', 'list', filter] as const,
  mockPage: (filter: MockFilter, page: MockPageArgs) => ['mocks', 'page', filter, page] as const,
  integrations: ['integrations'] as const,
  mock: (id: string) => ['mocks', 'detail', id] as const,
  endpoints: (integration: string) => ['integrations', integration, 'endpoints'] as const,
  mockHistory: (id: string) => ['mocks', 'history', id] as const,
  requests: ['requests'] as const,
  requestList: (filter: RequestFilter) => ['requests', 'list', filter] as const,
  request: (id: string) => ['requests', 'detail', id] as const,
  nearMisses: (id: string) => ['requests', 'near-misses', id] as const,
  recentUnmatched: ['requests', 'recent-unmatched'] as const,
  users: ['users'] as const,
  audit: ['audit'] as const,
  scenarios: ['scenarios'] as const,
  recordingState: ['recordings', 'state'] as const,
  recordings: ['recordings', 'lists'] as const,
  recording: (id: string) => ['recordings', 'lists', id] as const,
} as const

export const sessionQueryOptions = (fetchSession: () => Promise<SessionData> = defaultFetchSession) =>
  queryOptions({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 5 * 60_000,
    retry: false,
  })

function defaultFetchSession() {
  return apiFetch<SessionData>('/api/session', { redirectOnUnauthorized: false })
}

export type ServerConfig = PublicConfig

/** How the server runs (store driver, …); it only changes with a restart, so it is never refetched. */
export const serverConfigQueryOptions = (fetchConfig: () => Promise<ServerConfig> = () => apiFetch<ServerConfig>('/api/config')) =>
  queryOptions({
    queryKey: queryKeys.config,
    queryFn: fetchConfig,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

export function useSession() {
  return useQuery(sessionQueryOptions())
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      apiFetch<SessionData>('/api/session', { method: 'POST', body: credentials, redirectOnUnauthorized: false }),
    onSuccess: (session) => {
      // A fresh sign-in starts from an empty cache so a previous user's data cannot leak into this session.
      queryClient.clear()
      queryClient.setQueryData(queryKeys.session, session)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const t = useT()
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/session', { method: 'DELETE' }),
    onError: (error) => toast.error(error.message || t('user.signOutFailed')),
    onSuccess: async () => {
      queryClient.clear()
      await router.navigate({ to: '/login', search: {} })
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { current: string; next: string }) =>
      apiFetch<void>('/api/session/password', { method: 'POST', body: input }),
  })
}

export function useMocks(filter: MockFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.mockList(filter),
    queryFn: () => apiFetch<StubMapping[]>('/api/mocks', { query: filter }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
}

/**
 * One page of mocks (`GET /api/mocks?limit=&offset=`) for the mocks list. Callers that need every matching mock (a
 * scenario's steps, Reset my mocks) use `useMocks`, which asks without `limit` and gets the whole list.
 */
export function useMockPage(filter: MockFilter, page: MockPageArgs) {
  return useQuery({
    queryKey: queryKeys.mockPage(filter, page),
    queryFn: () => apiFetch<MockPage>('/api/mocks', { query: { ...filter, ...page } }),
    placeholderData: keepPreviousData,
  })
}

export const integrationsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.integrations,
    queryFn: () => apiFetch<Integration[]>('/api/integrations'),
    staleTime: 60_000,
  })

export function useIntegrations() {
  return useQuery(integrationsQueryOptions())
}

export function useDuplicateMock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<StubMapping>(`/api/mocks/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mocks }),
  })
}

export function useDeleteMock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      apiFetch<void>(`/api/mocks/${encodeURIComponent(id)}`, { method: 'DELETE', query: { version } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mocks }),
  })
}

/**
 * Restores a version of a mock. A plain function (not a hook): the Undo toast outlives the row that
 * offered it, so it must not depend on a mounted component.
 */
export async function restoreMock(queryClient: QueryClient, id: string, version: number) {
  const stub = await apiFetch<StubMapping>(`/api/mocks/${encodeURIComponent(id)}/restore`, { method: 'POST', body: { version } })
  await queryClient.invalidateQueries({ queryKey: queryKeys.mocks })
  return stub
}

export function useResetMine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ deleted: number }>('/api/mocks/reset-mine', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mocks }),
  })
}

export function useMock(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.mock(id),
    queryFn: () => apiFetch<StubMapping>(`/api/mocks/${encodeURIComponent(id)}`),
    enabled: options.enabled ?? true,
  })
}

export const endpointsQueryOptions = (integration: string) =>
  queryOptions({
    queryKey: queryKeys.endpoints(integration),
    queryFn: () => apiFetch<Endpoint[]>(`/api/integrations/${encodeURIComponent(integration)}/endpoints`),
    staleTime: 60_000,
  })

export function useEndpoints(integration: string | undefined) {
  return useQuery({ ...endpointsQueryOptions(integration ?? ''), enabled: Boolean(integration) })
}

export type CatalogMockInput = { integration: string; endpoint: string; input: SimpleMockInput }
/** A stub as the builder returns it (no id or server metadata yet). */
export type BuiltStub = Omit<StubMapping, 'id'>

const catalogMockPath = ({ integration, endpoint }: CatalogMockInput) =>
  `/api/integrations/${encodeURIComponent(integration)}/endpoints/${encodeURIComponent(endpoint)}`

/** What the Simple form previews: an endpoint mock, or a quick mock of a URL ("Mock a URL directly"). */
export type PreviewArgs = CatalogMockInput | { quick: QuickMockInput }

/** Builds the stub for a Simple form on the server without saving it. */
export function usePreviewMock() {
  return useMutation({
    mutationFn: (args: PreviewArgs) =>
      'quick' in args
        ? apiFetch<BuiltStub>('/api/mocks/preview', { method: 'POST', body: args.quick })
        : apiFetch<BuiltStub>(`${catalogMockPath(args)}/preview`, { method: 'POST', body: args.input }),
  })
}

export function useCreateCatalogMock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: CatalogMockInput) =>
      apiFetch<StubMapping>(`${catalogMockPath(args)}/mocks`, { method: 'POST', body: args.input }),
    onSuccess: async (stub) => {
      queryClient.setQueryData(queryKeys.mock(stub.id), stub)
      await queryClient.invalidateQueries({ queryKey: queryKeys.mocks, predicate: (q) => q.queryKey[1] !== 'detail' })
    },
  })
}

export function useUpdateMock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stub, version }: { id: string; stub: BuiltStub; version: number }) =>
      apiFetch<StubMapping>(`/api/mocks/${encodeURIComponent(id)}`, { method: 'PUT', body: { stub, version } }),
    onSuccess: async (stub) => {
      queryClient.setQueryData(queryKeys.mock(stub.id), stub)
      await queryClient.invalidateQueries({ queryKey: queryKeys.mocks, predicate: (q) => q.queryKey[1] !== 'detail' })
    },
  })
}

/** Previous versions of a mock, newest first (the live version is not included). */
export function useMockHistory(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.mockHistory(id),
    queryFn: () => apiFetch<StubMapping[]>(`/api/mocks/${encodeURIComponent(id)}/history`),
    enabled: options.enabled ?? true,
  })
}

/** Restores a previous version as the new live version (anyone signed in may). */
export function useRestoreMock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => restoreMock(queryClient, id, version),
    onSuccess: (stub) => queryClient.setQueryData(queryKeys.mock(stub.id), stub),
  })
}

/** Creates a free-form mock from a full stub (Advanced mode). */
export function useCreateMock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (stub: BuiltStub) => apiFetch<StubMapping>('/api/mocks', { method: 'POST', body: stub }),
    onSuccess: async (stub) => {
      queryClient.setQueryData(queryKeys.mock(stub.id), stub)
      await queryClient.invalidateQueries({ queryKey: queryKeys.mocks, predicate: (q) => q.queryKey[1] !== 'detail' })
    },
  })
}

// ── Request log ───────────────────────────────────────────────────────────────

/** How often the live request log asks for new requests, while the tab is visible. */
export const REQUEST_POLL_MS = 2000
/** Rows kept client-side; older ones fall off the bottom. */
export const MAX_REQUEST_ROWS = 500

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** True while the page is visible (`document.visibilityState`); always true on the server. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}

const newestFirst = (a: RequestSummary, b: RequestSummary) => Date.parse(b.loggedAt) - Date.parse(a.loggedAt)

/**
 * The cursor for the next incremental fetch: the newest row's time, one millisecond back. WireMock's `since`
 * is exclusive, so this also catches a request logged in that same millisecond after the last poll; the
 * overlap is merged away by id.
 */
export function sinceCursor(rows: RequestSummary[]): string | undefined {
  let newest = Number.NEGATIVE_INFINITY
  for (const r of rows) newest = Math.max(newest, Date.parse(r.loggedAt) || Number.NEGATIVE_INFINITY)
  return Number.isFinite(newest) ? new Date(newest - 1).toISOString() : undefined
}

/** New rows merged into the old ones by id, newest first, trimmed to the time window and to MAX_REQUEST_ROWS. */
export function mergeRequests(fresh: RequestSummary[], old: RequestSummary[], windowStart?: number): RequestSummary[] {
  const byId = new Map<string, RequestSummary>()
  for (const r of [...old, ...fresh]) byId.set(r.id, r)
  let rows = [...byId.values()].sort(newestFirst)
  if (windowStart !== undefined) rows = rows.filter((r) => Date.parse(r.loggedAt) >= windowStart)
  return rows.slice(0, MAX_REQUEST_ROWS)
}

/**
 * The live request log. The first fetch loads the newest MAX_REQUEST_ROWS; every later one (each
 * REQUEST_POLL_MS while `live` and the tab is visible) asks only for what came after the newest row.
 */
export function useRequests(filter: RequestFilter, options: { live?: boolean } = {}) {
  const queryClient = useQueryClient()
  const visible = useDocumentVisible()
  const key = queryKeys.requestList(filter)
  const live = options.live ?? true
  const polling = live && visible
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { windowMinutes, ...rest } = filter
      const windowStart = windowMinutes ? Date.now() - windowMinutes * 60_000 : undefined
      const old = queryClient.getQueryData<RequestSummary[]>(key) ?? []
      const cursor = old.length > 0 ? sinceCursor(old) : undefined
      const since = cursor ?? (windowStart !== undefined ? new Date(windowStart).toISOString() : undefined)
      const fresh = await apiFetch<RequestSummary[]>('/api/requests', { query: { ...rest, since, limit: MAX_REQUEST_ROWS } })
      return mergeRequests(fresh, old, windowStart)
    },
    placeholderData: keepPreviousData,
    refetchInterval: polling ? REQUEST_POLL_MS : false,
    refetchIntervalInBackground: false,
    // Coming back to the tab fetches what was missed straight away (still incremental), unless paused.
    refetchOnWindowFocus: live,
  })
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.request(id ?? ''),
    queryFn: () => apiFetch<LoggedEvent>(`/api/requests/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
    staleTime: Number.POSITIVE_INFINITY, // a logged request never changes
  })
}

/** The closest mocks for an unmatched request, each with its field-by-field explanation. */
export function useNearMisses(id: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.nearMisses(id ?? ''),
    queryFn: () => apiFetch<NearMissView[]>(`/api/requests/${encodeURIComponent(id!)}/near-misses`),
    enabled: Boolean(id) && (options.enabled ?? true),
  })
}

/** Empties WireMock's request journal (for everyone). */
export function useClearRequests() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/requests', { method: 'DELETE' }),
    onSuccess: async () => {
      // Empty every cached list (so no stale cursor survives and the next fetch is a full one), then refetch.
      const lists = { queryKey: [...queryKeys.requests, 'list'] }
      queryClient.setQueriesData<RequestSummary[]>(lists, [])
      await queryClient.invalidateQueries(lists)
      await queryClient.invalidateQueries({ queryKey: queryKeys.recentUnmatched })
    },
  })
}

/** The window and refresh rate of the sidebar's unmatched-requests count. */
export const RECENT_UNMATCHED_MINUTES = 15
export const RECENT_UNMATCHED_POLL_MS = 15_000

/**
 * How many requests matched no mock in the last RECENT_UNMATCHED_MINUTES (a small count endpoint over WireMock's
 * unmatched journal, capped at 100 for the "99+" badge). Refreshed every RECENT_UNMATCHED_POLL_MS only while the tab
 * is visible; a failure just shows no count.
 */
export function useRecentUnmatchedCount(options: { enabled?: boolean } = {}) {
  const visible = useDocumentVisible()
  return useQuery({
    queryKey: queryKeys.recentUnmatched,
    queryFn: async () =>
      (await apiFetch<{ count: number; capped: boolean }>('/api/requests/unmatched-count', { query: { minutes: RECENT_UNMATCHED_MINUTES } }))
        .count,
    enabled: options.enabled ?? true,
    refetchInterval: visible ? RECENT_UNMATCHED_POLL_MS : false,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

export function useCountRequests() {
  return useMutation({
    mutationFn: (pattern: Record<string, unknown>) =>
      apiFetch<{ count: number }>('/api/requests/count', { method: 'POST', body: { pattern } }),
  })
}

/** Sends one request to WireMock through the server relay (the browser never talks to WireMock itself). */
export function useSendTestRequest() {
  return useMutation({
    mutationFn: (input: TestRequestInput) => apiFetch<TestRequestResult>('/api/test-request', { method: 'POST', body: input }),
  })
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

/** How often the Scenarios page asks for the live states, while the tab is visible. */
export const SCENARIO_POLL_MS = 2000

/** Every scenario with its states, mocks and live state. `live` polls every SCENARIO_POLL_MS while the tab is visible. */
export function useScenarios(options: { live?: boolean; enabled?: boolean } = {}) {
  const visible = useDocumentVisible()
  const polling = Boolean(options.live) && visible
  return useQuery({
    queryKey: queryKeys.scenarios,
    queryFn: async () => (await apiFetch<{ scenarios: Scenario[] }>('/api/scenarios')).scenarios,
    enabled: options.enabled ?? true,
    refetchInterval: polling ? SCENARIO_POLL_MS : false,
    refetchIntervalInBackground: false,
  })
}

const scenarioPath = (name: string) => `/api/scenarios/${encodeURIComponent(name)}/state`

export function useSetScenarioState() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, state }: { name: string; state: string }) => apiFetch<Scenario>(scenarioPath(name), { method: 'PUT', body: { state } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.scenarios }),
  })
}

/** Resets one scenario (`name`) or, without a name, every scenario back to Started. */
export function useResetScenarios() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name?: string) => apiFetch<void>('/api/scenarios/reset', { method: 'POST', body: name === undefined ? {} : { name } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.scenarios }),
  })
}

// ── Catalog management ────────────────────────────────────────────────────────

/** What a PUT carries: the server fills `key` (and `integration`) from the path and stamps updatedAt/updatedBy. */
export type IntegrationInput = Omit<Integration, 'updatedAt' | 'updatedBy'>
export type EndpointInput = Omit<Endpoint, 'updatedAt' | 'updatedBy'>

const integrationPath = (key: string) => `/api/integrations/${encodeURIComponent(key)}`

/** `If-None-Match: *` makes the server refuse (409) instead of overwriting an existing key. */
const createOnlyHeaders = (createOnly?: boolean) => (createOnly ? { 'If-None-Match': '*' } : undefined)

export function useUpsertIntegration({ createOnly }: { createOnly?: boolean } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, ...body }: IntegrationInput) =>
      apiFetch<Integration>(integrationPath(key), { method: 'PUT', body, headers: createOnlyHeaders(createOnly) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.integrations }),
  })
}

/** Deletes an integration. The caller leaves the page first, then calls forgetIntegration (so no "not found" flashes). */
export function useDeleteIntegration() {
  return useMutation({
    mutationFn: (key: string) => apiFetch<void>(integrationPath(key), { method: 'DELETE' }),
  })
}

/** Drops a deleted integration's cached endpoints and refreshes the integration list. */
export function forgetIntegration(queryClient: QueryClient, key: string) {
  queryClient.removeQueries({ queryKey: queryKeys.endpoints(key) })
  return queryClient.invalidateQueries({ queryKey: queryKeys.integrations })
}

export function useUpsertEndpoint({ createOnly }: { createOnly?: boolean } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ integration, key, ...body }: EndpointInput) =>
      apiFetch<Endpoint>(`${integrationPath(integration)}/endpoints/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body,
        headers: createOnlyHeaders(createOnly),
      }),
    onSuccess: (_endpoint, input) => queryClient.invalidateQueries({ queryKey: queryKeys.endpoints(input.integration) }),
  })
}

export function useDeleteEndpoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ integration, key }: { integration: string; key: string }) =>
      apiFetch<void>(`${integrationPath(integration)}/endpoints/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: (_void, input) => queryClient.invalidateQueries({ queryKey: queryKeys.endpoints(input.integration) }),
  })
}

export function useUsers() {
  return useQuery({ queryKey: queryKeys.users, queryFn: () => apiFetch<PublicUser[]>('/api/users') })
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { username: string; displayName?: string; password: string }) =>
      apiFetch<PublicUser>('/api/users', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; displayName?: string; password?: string; disabled?: boolean }) =>
      apiFetch<PublicUser>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  })
}

export const AUDIT_PAGE_SIZE = 50

export function useAudit() {
  return useInfiniteQuery({
    queryKey: queryKeys.audit,
    queryFn: ({ pageParam }) =>
      apiFetch<AuditPage>('/api/audit', { query: { limit: AUDIT_PAGE_SIZE, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ bundle, prune }: { bundle: unknown; prune: boolean }) =>
      apiFetch<ImportReport>('/api/import', { method: 'POST', body: bundle, query: { prune: prune ? 'true' : undefined } }),
    // An import can touch mocks, the catalog and the audit trail.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mocks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.integrations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.audit }),
      ]),
  })
}

// ── Recording (spec A12) ─────────────────────────────────────────────────────────

export const RECORDING_POLL_MS = 5000

/** Whether WireMock is recording, polled while the tab is visible (the app-wide banner and the Recording page). */
export function useRecordingState(options: { enabled?: boolean } = {}) {
  const visible = useDocumentVisible()
  return useQuery({
    queryKey: queryKeys.recordingState,
    queryFn: () => apiFetch<RecordingState>('/api/recordings/status'),
    enabled: options.enabled ?? true,
    refetchInterval: visible ? RECORDING_POLL_MS : false,
    refetchIntervalInBackground: false,
    retry: false,
  })
}

export function useStartRecording() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: StartInput) => apiFetch<RecordingState>('/api/recordings/start', { method: 'POST', body: input }),
    onSuccess: (state) => queryClient.setQueryData(queryKeys.recordingState, state),
  })
}

export function useStopRecording() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ recording: Recording | null }>('/api/recordings/stop', { method: 'POST' }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recordingState }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recordings }),
      ]),
  })
}

export function useSnapshot() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SnapshotInput) => apiFetch<{ recording: Recording | null }>('/api/recordings/snapshot', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.recordings }),
  })
}

/** Review lists waiting to be accepted (they expire after 24 hours). */
export function useRecordings(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.recordings,
    queryFn: async () => (await apiFetch<{ recordings: Recording[] }>('/api/recordings')).recordings,
    enabled: options.enabled ?? true,
  })
}

export function useAcceptRecording() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, items, owner }: { id: string; items: AcceptItem[]; owner: 'me' | 'baseline' }) =>
      apiFetch<AcceptResult>(`/api/recordings/${encodeURIComponent(id)}/accept`, { method: 'POST', body: { items, owner } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recordings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mocks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.integrations }),
      ]),
  })
}

/** Drops the given rows, or the whole review list when `ids` is left out. */
export function useDiscardRecording() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ids }: { id: string; ids?: string[] }): Promise<Recording | null> => {
      const path = `/api/recordings/${encodeURIComponent(id)}`
      if (!ids) {
        await apiFetch<void>(path, { method: 'DELETE' })
        return null
      }
      return (await apiFetch<{ recording: Recording | null }>(`${path}/discard`, { method: 'POST', body: { ids } })).recording
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.recordings }),
  })
}
