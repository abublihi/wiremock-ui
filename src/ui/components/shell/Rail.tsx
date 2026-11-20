import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { useT, type MessageKey } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'

/** Most used first: the daily work, then what it is built on, then people and records, then the guide. */
export type NavGroup = 'work' | 'setup' | 'admin' | 'help'
export type NavItem = { to: string; label: MessageKey; icon: LucideIcon; group: NavGroup }

/** A small number after a nav item (unmatched requests, say), keyed by the item's `to`; 0 or none shows nothing. */
export type NavCounts = Partial<Record<string, number>>

const GROUPS: { id: NavGroup; label: MessageKey }[] = [
  { id: 'work', label: 'nav.groupWork' },
  { id: 'setup', label: 'nav.groupSetup' },
  { id: 'admin', label: 'nav.groupAdmin' },
  { id: 'help', label: 'nav.groupHelp' },
]

const LINK =
  "group/nav relative flex items-center gap-2.5 rounded-md px-3 py-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-surface-2 hover:text-foreground data-[status=active]:bg-signal/8 data-[status=active]:font-medium data-[status=active]:text-signal-fg data-[status=active]:before:absolute data-[status=active]:before:start-0 data-[status=active]:before:top-1/2 data-[status=active]:before:h-5 data-[status=active]:before:w-[3px] data-[status=active]:before:-translate-y-1/2 data-[status=active]:before:rounded-e-full data-[status=active]:before:bg-signal data-[status=active]:after:text-[9px] data-[status=active]:after:opacity-60 data-[status=active]:after:content-['●']"

export function Rail({ nav, counts, onNavigate }: { nav: NavItem[]; counts?: NavCounts; onNavigate?: () => void }) {
  const t = useT()
  return (
    <nav aria-label={t('nav.label')} className="flex flex-col gap-6 px-3 pt-5 pb-3">
      {GROUPS.map((group) => {
        const items = nav.filter((item) => item.group === group.id)
        if (items.length === 0) return null
        return (
          <div key={group.id} role="group" aria-label={t(group.label)} className="flex flex-col gap-0.5">
            <p aria-hidden className="mb-2 px-2 text-[9px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              // {t(group.label)}
            </p>
            {items.map((item) => {
              const count = counts?.[item.to] ?? 0
              return (
                <Link
                  key={item.to}
                  // NavItem.to is a plain string so the nav can be declared before every route exists.
                  to={item.to as '/'}
                  onClick={onNavigate}
                  // The active dot sits at the end of the row; a count takes that place and the dot follows it.
                  className={cn(LINK, count > 0 ? 'data-[status=active]:after:ms-2' : 'data-[status=active]:after:ms-auto')}
                >
                  <item.icon aria-hidden className="size-3.5 shrink-0" />
                  {t(item.label)}
                  {count > 0 && (
                    <span
                      className="ms-auto rounded-sm border border-mismatch/40 bg-mismatch/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-mismatch tabular-nums"
                      title={t('nav.unmatchedCount', { count })}
                    >
                      <span aria-hidden>{count > 99 ? '99+' : count}</span>
                      <span className="sr-only">{t('nav.unmatchedCount', { count })}</span>
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}
