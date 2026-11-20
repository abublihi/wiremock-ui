import type { AuditEntry } from '@/server/audit/log'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { isValidDate, relativeTime } from '@/ui/lib/time'
import { cn } from '@/ui/lib/utils'

const COLUMNS = [
  { key: 'audit.colTime', hide: false },
  { key: 'audit.colActor', hide: false },
  { key: 'audit.colAction', hide: false },
  { key: 'audit.colTarget', hide: true },
  { key: 'audit.colDetails', hide: true },
] as const

function TableShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((col) => (
              <TableHead key={col.key} className={cn('text-[11px] tracking-[0.14em] text-muted-foreground uppercase', col.hide && 'hidden md:table-cell')}>
                {t(col.key)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </div>
  )
}

export function AuditTableSkeleton() {
  return (
    <TableShell>
      <TableBody>
        {Array.from({ length: 8 }, (_, i) => (
          <TableRow key={i}>
            {Array.from({ length: 5 }, (_, j) => (
              <TableCell key={j} className={cn(j > 2 && 'hidden md:table-cell')}>
                <Skeleton className="h-4 w-full max-w-32" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

/** `{"a":1,"b":"x"}` on one line; empty for nothing to say. */
export function compactJson(details: AuditEntry['details']): string {
  if (!details || Object.keys(details).length === 0) return ''
  return JSON.stringify(details)
}

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return (
    <TableShell>
      <TableBody>
        {entries.map((entry, i) => {
          const details = compactJson(entry.details)
          return (
            <TableRow key={`${entry.at}-${i}`} className="hover:bg-surface-2">
              <TableCell className="text-xs whitespace-nowrap">
                {isValidDate(entry.at) ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <time dateTime={entry.at} className="cursor-default text-muted-foreground">
                        {relativeTime(entry.at)}
                      </time>
                    </TooltipTrigger>
                    <TooltipContent>{new Date(entry.at).toLocaleString('en')}</TooltipContent>
                  </Tooltip>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-xs">{entry.actor}</TableCell>
              <TableCell>
                <span dir="ltr" className="font-mono text-xs text-signal-fg">
                  {entry.action}
                </span>
                {entry.target && <p dir="ltr" className="max-w-40 truncate font-mono text-[11px] text-muted-foreground md:hidden">{entry.target}</p>}
              </TableCell>
              <TableCell dir="ltr" className="hidden max-w-48 truncate font-mono text-xs md:table-cell" title={entry.target}>
                {entry.target ?? '—'}
              </TableCell>
              <TableCell dir="ltr" className="hidden max-w-80 truncate font-mono text-xs text-muted-foreground md:table-cell" title={details}>
                {details || '—'}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </TableShell>
  )
}
