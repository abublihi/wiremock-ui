import { createFileRoute } from '@tanstack/react-router'
import type { PublicUser, Role } from '@/server/users/types'
import { APP_NAV, AppShell } from '@/ui/components/shell/AppShell'
import { useT } from '@/ui/i18n'

// TEMPORARY shell preview — Task 2 replaces this route with the authenticated layout.
// The fake user's role comes from `?role=` only in development; otherwise it is a viewer.
const ROLES: readonly Role[] = ['viewer', 'tester', 'developer', 'admin']

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { role?: Role } =>
    import.meta.env.DEV && ROLES.includes(search.role as Role) ? { role: search.role as Role } : {},
  component: ShellPreview,
})

function ShellPreview() {
  const t = useT()
  const { role = 'viewer' } = Route.useSearch()
  const user: PublicUser = {
    id: 'preview',
    username: 'preview',
    displayName: 'Preview user',
    role,
    disabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return (
    <AppShell nav={APP_NAV} user={user}>
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="font-condensed text-2xl font-semibold">{t('preview.title')}</h1>
        <p className="text-muted-foreground">{t('preview.body')}</p>
      </div>
    </AppShell>
  )
}
