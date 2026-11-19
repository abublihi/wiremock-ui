import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { SESSION_KEY, apiFetch, type SessionData } from './client'

/** Single source for every query key. Later tasks add their resources here. */
export const queryKeys = {
  session: SESSION_KEY,
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
    onSuccess: (session) => queryClient.setQueryData(queryKeys.session, session),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/session', { method: 'DELETE' }),
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
