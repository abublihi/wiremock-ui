import type { ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { ArrowDownUpIcon, CircleDotIcon, DatabaseIcon, FileClockIcon, ListIcon, ScrollTextIcon, UsersIcon, WorkflowIcon } from 'lucide-react'
import type { PublicUser } from '@/server/users/types'
import type { ServerConfig } from '@/ui/api/queries'
import { useT } from '@/ui/i18n'
import { Brand } from './Brand'
import { HazardStrip } from './HazardStrip'
import { RecordingBanner } from './RecordingBanner'
import type { NavCounts, NavItem } from './Rail'
import { SidebarContent, TopBar } from './TopBar'

export type { NavCounts, NavItem } from './Rail'

/**
 * The app's navigation, most used first: every signed-in user sees every entry (there is no authorization).
 * Work is what testers do all day, Setup is what mocks are built on, Admin is people and records.
 */
export const APP_NAV: NavItem[] = [
  { to: '/mocks', label: 'nav.mocks', icon: ListIcon, group: 'work' },
  { to: '/scenarios', label: 'nav.scenarios', icon: WorkflowIcon, group: 'work' },
  { to: '/requests', label: 'nav.requests', icon: ScrollTextIcon, group: 'work' },
  { to: '/recording', label: 'nav.recording', icon: CircleDotIcon, group: 'work' },
  { to: '/integrations', label: 'nav.integrations', icon: DatabaseIcon, group: 'setup' },
  { to: '/import', label: 'nav.import', icon: ArrowDownUpIcon, group: 'setup' },
  { to: '/users', label: 'nav.users', icon: UsersIcon, group: 'admin' },
  { to: '/audit', label: 'nav.audit', icon: FileClockIcon, group: 'admin' },
]

/**
 * The nav for how the server runs: WireMock-only mode has no accounts to manage, so no Users page; with
 * RECORDING_ALLOWED=false there is no Recording page. An unknown config shows everything.
 */
export function navFor(config: ServerConfig | null): NavItem[] {
  return APP_NAV.filter(
    (item) => !(item.to === '/users' && config?.storeDriver === 'none') && !(item.to === '/recording' && config?.recordingAllowed === false),
  )
}

export function AppShell({ nav, counts, user, children }: { nav: NavItem[]; counts?: NavCounts; user: PublicUser | null; children: ReactNode }) {
  const t = useT()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div className="flex h-svh flex-col bg-background">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-3 py-2 font-medium focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50"
      >
        {t('shell.skipToContent')}
      </a>
      <HazardStrip />
      <RecordingBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="sidebar-enter hidden w-[228px] shrink-0 flex-col border-e bg-surface md:flex">
          <div className="border-b border-line/60 px-5 pt-5 pb-6">
            <Brand caption />
          </div>
          <SidebarContent nav={nav} counts={counts} user={user} />
        </aside>
        <div className="dot-grid flex min-w-0 flex-1 flex-col overflow-y-auto">
          <TopBar nav={nav} counts={counts} user={user} />
          <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
            {/* Keyed by path so every page change replays the fade-up. */}
            <div key={pathname} className="fade-up">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
