import { keepPreviousData, queryOptions, type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useT } from '@/ui/i18n'
import type { SimpleMockInput } from '@/server/catalog/build'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { SESSION_KEY, apiFetch, type SessionData } from './client'

export type MockFilter = { owner?: string; integration?: string; status?: string; q?: string }

/** Single source for every query key. Later tasks add their resources here. */
export const queryKeys = {
  session: SESSION_KEY,
  mocks: ['mocks'] as const,
  mockList: (filter: MockFilter) => ['mocks', 'list', filter] as const,
  integrations: ['integrations'] as const,
  mock: (id: string) => ['mocks', 'detail', id] as const,
  endpoints: (integration: string) => ['integrations', integration, 'endpoints'] as const,
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

export function useIntegrations() {
  return useQuery({
    queryKey: queryKeys.integrations,
    queryFn: () => apiFetch<Integration[]>('/api/integrations'),
    staleTime: 60_000,
  })
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

export function useMock(id: string) {
  return useQuery({
    queryKey: queryKeys.mock(id),
    queryFn: () => apiFetch<StubMapping>(`/api/mocks/${encodeURIComponent(id)}`),
  })
}

export function useEndpoints(integration: string | undefined) {
  return useQuery({
    queryKey: queryKeys.endpoints(integration ?? ''),
    queryFn: () => apiFetch<Endpoint[]>(`/api/integrations/${encodeURIComponent(integration!)}/endpoints`),
    enabled: Boolean(integration),
    staleTime: 60_000,
  })
}

export type CatalogMockInput = { integration: string; endpoint: string; input: SimpleMockInput }
/** A stub as the builder returns it (no id or server metadata yet). */
export type BuiltStub = Omit<StubMapping, 'id'>

const catalogMockPath = ({ integration, endpoint }: CatalogMockInput) =>
  `/api/integrations/${encodeURIComponent(integration)}/endpoints/${encodeURIComponent(endpoint)}`

/** Builds the stub for a Simple form on the server without saving it. */
export function usePreviewMock() {
  return useMutation({
    mutationFn: (args: CatalogMockInput) =>
      apiFetch<BuiltStub>(`${catalogMockPath(args)}/preview`, { method: 'POST', body: args.input }),
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
