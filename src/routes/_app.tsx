import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useSession } from '@/ui/api/queries'
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
  return (
    <ServerConfigProvider config={serverConfig}>
      <AppShell nav={navFor(serverConfig)} user={data?.user ?? session.user}>
        <Outlet />
      </AppShell>
    </ServerConfigProvider>
  )
}
