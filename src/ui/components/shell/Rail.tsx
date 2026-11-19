import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { useT, type MessageKey } from '@/ui/i18n'

export type NavItem = { to: string; label: MessageKey; icon: LucideIcon }

export function Rail({ nav, onNavigate }: { nav: NavItem[]; onNavigate?: () => void }) {
  const t = useT()
  return (
    <nav aria-label={t('nav.label')} className="flex flex-col gap-1 p-3">
      {nav.map((item) => (
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
