import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { can, type Permission } from '@/server/auth/permissions'
import type { PublicUser } from '@/server/users/types'
import { useT, type MessageKey } from '@/ui/i18n'

export type NavItem = { to: string; label: MessageKey; icon: LucideIcon; permission?: Permission }

/** Items without a permission are always shown; the rest only to roles that hold it. */
export function visibleNav(nav: NavItem[], user: PublicUser | null): NavItem[] {
  return nav.filter((item) => !item.permission || (user !== null && can(user.role, item.permission)))
}

export function Rail({ nav, user, onNavigate }: { nav: NavItem[]; user: PublicUser | null; onNavigate?: () => void }) {
  const t = useT()
  return (
    <nav aria-label={t('nav.label')} className="flex flex-col gap-1 p-3">
      {visibleNav(nav, user).map((item) => (
        <Link
          key={item.to}
          // NavItem.to is a plain string so the nav can be declared before every route exists.
          to={item.to as '/'}
          onClick={onNavigate}
          className="relative flex items-center gap-3 rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground data-[status=active]:before:absolute data-[status=active]:before:inset-y-1.5 data-[status=active]:before:start-0 data-[status=active]:before:w-0.5 data-[status=active]:before:rounded-full data-[status=active]:before:bg-signal"
        >
          <item.icon aria-hidden className="size-4 shrink-0" />
          {t(item.label)}
        </Link>
      ))}
    </nav>
  )
}
