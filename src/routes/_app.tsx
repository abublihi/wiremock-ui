import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useSession } from '@/ui/api/queries'
import { requireSession } from '@/ui/auth/session'
import { APP_NAV, AppShell } from '@/ui/components/shell/AppShell'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => ({
    session: await requireSession(context.queryClient, location),
  }),
  component: AppLayout,
})

function AppLayout() {
  // The query keeps the user current (after a password change, say); beforeLoad guarantees it is cached.
  const { data } = useSession()
  return (
    <AppShell nav={APP_NAV} user={data?.user ?? Route.useRouteContext().session.user}>
      <Outlet />
    </AppShell>
  )
}
