import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useRecentUnmatchedCount, useSession } from '@/ui/api/queries'
import { loadConfigForApp, requireSession } from '@/ui/auth/session'
import { AppShell, navFor } from '@/ui/components/shell/AppShell'
import { ServerConfigProvider } from '@/ui/config'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => ({
    session: await requireSession(context.queryClient, location),
    serverConfig: await loadConfigForApp(context.queryClient),
  }),
  component: AppLayout,
})

function AppLayout() {
  // The query keeps the user current (after a password change, say); beforeLoad guarantees it is cached.
  const { data } = useSession()
  const { session, serverConfig } = Route.useRouteContext()
  // The Request log nav item shows how many requests matched no mock lately.
  const unmatched = useRecentUnmatchedCount()
  return (
    <ServerConfigProvider config={serverConfig}>
      <AppShell nav={navFor(serverConfig)} counts={{ '/requests': unmatched.data ?? 0 }} user={data?.user ?? session.user}>
        <Outlet />
      </AppShell>
    </ServerConfigProvider>
  )
}
