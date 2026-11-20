import { useEffect, useMemo, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import type { RequestSummary } from '@/server/requests/journal'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'
import { NoMatchStamp } from './NoMatchStamp'

const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const FULL = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'long',
  hour12: false,
})

/** HH:mm:ss (local) with the full date, time and milliseconds in a tooltip. */
export function LoggedTime({ iso }: { iso: string }) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return <span className="text-muted-foreground">—</span>
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso} className="cursor-default font-mono text-xs text-muted-foreground tabular-nums">
          {CLOCK.format(date)}
        </time>
      </TooltipTrigger>
      <TooltipContent>
        {FULL.format(date)} · {ms} ms
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Ids that arrived after the rows were first shown, for the live-row flash. Nothing flashes until `ready`
 * (real data, not a placeholder from the previous filter), and a new `scope` (another filter) starts over,
 * so a page load or a filter change doesn't light up every row. Kept by the page, not the table, so the
 * first request after an empty log flashes too.
 */
export function useFreshIds(rows: RequestSummary[], ready: boolean, scope: string): Set<string> {
  const seen = useRef<{ scope: string; ids: Set<string> } | null>(null)
  const fresh = useMemo(() => {
    const known = seen.current
    if (!known || known.scope !== scope || !ready) return new Set<string>()
    return new Set(rows.filter((r) => !known.ids.has(r.id)).map((r) => r.id))
  }, [rows, ready, scope])
  useEffect(() => {
    if (ready) seen.current = { scope, ids: new Set(rows.map((r) => r.id)) }
  }, [rows, ready, scope])
  return fresh
}

export function RequestTable({
  rows,
  fresh,
  selectedId,
  onOpen,
}: {
  rows: RequestSummary[]
  /** Rows that just arrived: they flash once. */
  fresh?: Set<string>
  selectedId?: string
  onOpen: (id: string) => void
}) {
  const t = useT()
  return (
    <TableShell>
      <TableBody>
        {rows.map((r) => (
          <TableRow
            key={r.id}
            data-state={r.id === selectedId ? 'selected' : undefined}
            onClick={() => onOpen(r.id)}
            className={cn(
              'cursor-pointer hover:bg-surface-2 data-[state=selected]:bg-signal/[0.07]',
              !r.matched && 'bg-hazard/[0.03]',
              fresh?.has(r.id) && 'live-flash',
            )}
          >
            <TableCell className="w-20">
              <LoggedTime iso={r.loggedAt} />
            </TableCell>
            <TableCell className="w-16">
              <MethodBadge method={r.method} />
            </TableCell>
            <TableCell className="max-w-32 sm:max-w-72 lg:max-w-md">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    dir="ltr"
                    aria-label={t('requests.openDetails', { method: r.method, url: r.url })}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(r.id)
                    }}
                    className="block max-w-full truncate rounded-sm text-start font-mono text-xs hover:text-signal-fg"
                  >
                    {r.url}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-md font-mono break-all">{r.url}</TooltipContent>
              </Tooltip>
            </TableCell>
            <TableCell className="hidden w-16 sm:table-cell">
              {r.status === null ? <span className="text-muted-foreground">—</span> : <StatusBadge status={r.status} />}
            </TableCell>
            <TableCell className="max-w-44 md:max-w-64">
              {r.matched && r.recordingProxy ? (
                // The recording's catch-all proxy has no name of ours: say what it did.
                <span className="flex min-w-0 items-center gap-2" title={r.forwardedTo ?? undefined}>
                  <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-hazard motion-reduce:animate-none" />
                  <span className="truncate text-xs">
                    {t('requests.recordedVia')}{' '}
                    <span dir="ltr" className="font-mono text-muted-foreground">
                      {r.forwardedTo ?? ''}
                    </span>
                  </span>
                </span>
              ) : r.matched ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-match" />
                  {r.stubId ? (
                    <Link
                      to="/mocks/$id"
                      params={{ id: r.stubId }}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate text-xs font-medium hover:text-signal-fg hover:underline"
                    >
                      {r.stubName || t('requests.unnamedMock')}
                    </Link>
                  ) : (
                    <span className="truncate text-xs">{r.stubName || t('requests.unnamedMock')}</span>
                  )}
                </span>
              ) : (
                <NoMatchStamp onClick={() => onOpen(r.id)} />
              )}
            </TableCell>
            <TableCell className="hidden w-20 text-end font-mono text-xs text-muted-foreground tabular-nums md:table-cell">
              {r.durationMs === null ? '—' : t('requests.ms', { ms: r.durationMs })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

export function RequestTableSkeleton() {
  return (
    <TableShell>
      <TableBody>
        {Array.from({ length: 8 }, (_, i) => (
          <TableRow key={i}>
            {Array.from({ length: 6 }, (_, j) => (
              <TableCell key={j} className={cn(j === 3 && 'hidden sm:table-cell', j === 5 && 'hidden md:table-cell')}>
                <Skeleton className="h-4 w-full max-w-28" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

const COLUMNS = [
  ['Time', ''],
  ['Method', ''],
  ['Url', ''],
  ['Status', 'hidden sm:table-cell'],
  ['Result', ''],
  ['Duration', 'hidden text-end md:table-cell'],
] as const

function TableShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map(([col, className]) => (
              <TableHead key={col} className={cn('text-[11px] tracking-[0.14em] text-muted-foreground uppercase', className)}>
                {t(`requests.col${col}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </div>
  )
}
