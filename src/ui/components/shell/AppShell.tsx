import type { ReactNode } from 'react'
import { DatabaseIcon, FileClockIcon, ListIcon, ScrollTextIcon, UploadIcon, UsersIcon } from 'lucide-react'
import type { PublicUser } from '@/server/users/types'
import { useT } from '@/ui/i18n'
import { HazardStrip } from './HazardStrip'
import { Rail, type NavItem } from './Rail'
import { TopBar } from './TopBar'

export type { NavItem } from './Rail'

/** The app's navigation; entries with a permission are hidden from roles without it. */
export const APP_NAV: NavItem[] = [
  { to: '/mocks', label: 'nav.mocks', icon: ListIcon, permission: 'mocks.read' },
  { to: '/requests', label: 'nav.requests', icon: ScrollTextIcon, permission: 'requests.read' },
  { to: '/catalog', label: 'nav.catalog', icon: DatabaseIcon, permission: 'catalog.read' },
  { to: '/users', label: 'nav.users', icon: UsersIcon, permission: 'users.manage' },
  { to: '/audit', label: 'nav.audit', icon: FileClockIcon, permission: 'audit.read' },
  { to: '/import', label: 'nav.import', icon: UploadIcon, permission: 'import.run' },
]

export function AppShell({ nav, user, children }: { nav: NavItem[]; user: PublicUser | null; children: ReactNode }) {
  const t = useT()
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-3 py-2 font-medium focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50"
      >
        {t('shell.skipToContent')}
      </a>
      <HazardStrip />
      <TopBar nav={nav} user={user} />
      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-e bg-surface md:block">
          <Rail nav={nav} user={user} />
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
