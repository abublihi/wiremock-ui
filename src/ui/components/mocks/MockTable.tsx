import { Link } from '@tanstack/react-router'
import type { StubMapping } from '@/server/wiremock/types'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Badge } from '@/ui/components/ui/badge'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'
import { MockRowActions, mockName } from './MockActions'

const URL_FIELDS = ['url', 'urlPath', 'urlPattern', 'urlPathPattern', 'urlPathTemplate'] as const

function requestUrl(stub: StubMapping): string {
  for (const field of URL_FIELDS) {
    const value = stub.request[field]
    if (typeof value === 'string') return value
  }
  return '—'
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(0, 'second')
}

function UpdatedAt({ iso }: { iso?: string }) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return <span className="text-muted-foreground">—</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso} className="cursor-default text-muted-foreground">
          {relativeTime(iso)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{new Date(iso).toLocaleString('en')}</TooltipContent>
    </Tooltip>
  )
}

export function MockTable({ mocks }: { mocks: StubMapping[] }) {
  const t = useT()
  return (
    <TableShell>
      <TableBody className="stagger-children">
        {mocks.map((stub) => {
          const meta = stub.metadata?.wiremockUi
          const method = typeof stub.request.method === 'string' ? stub.request.method : 'ANY'
          const status = typeof stub.response.status === 'number' ? stub.response.status : 200
          const owner = meta?.owner ?? 'baseline'
          return (
            <TableRow key={stub.id} className="hover:bg-surface-2">
              <TableCell className="max-w-28 whitespace-normal md:max-w-64">
                <Link to="/mocks/$id" params={{ id: stub.id }} className="font-medium hover:text-signal-fg hover:underline">
                  {stub.name || t('mocks.unnamed')}
                </Link>
                {(meta?.integration || meta?.endpoint) && (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {[meta.integration, meta.endpoint].filter(Boolean).join(' · ')}
                  </p>
                )}
              </TableCell>
              <TableCell className="max-w-36 md:max-w-80">
                <div className="flex items-center gap-2">
                  <MethodBadge method={method} />
                  <span dir="ltr" className="truncate font-mono text-xs" title={requestUrl(stub)}>
                    {requestUrl(stub)}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={status} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {owner === 'baseline' ? (
                  <Badge variant="outline" className="border-hazard/40 bg-hazard/10 text-hazard-fg">
                    {t('mocks.baseline')}
                  </Badge>
                ) : (
                  <span className="text-xs">{owner}</span>
                )}
              </TableCell>
              <TableCell className="hidden text-xs md:table-cell">
                <UpdatedAt iso={meta?.updatedAt} />
              </TableCell>
              <TableCell className="text-end">
                <MockRowActions stub={stub} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </TableShell>
  )
}

export function MockTableSkeleton() {
  return (
    <TableShell>
      <TableBody>
        {Array.from({ length: 6 }, (_, i) => (
          <TableRow key={i}>
            {Array.from({ length: 6 }, (_, j) => (
              <TableCell key={j}>
                <Skeleton className="h-4 w-full max-w-32" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

function TableShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {(['Name', 'Request', 'Status', 'Owner', 'Updated'] as const).map((col) => (
              <TableHead key={col} className={cn('text-[10px] tracking-[0.14em] text-muted-foreground uppercase', (col === 'Owner' || col === 'Updated') && 'hidden md:table-cell')}>
                {t(`mocks.col${col}`)}
              </TableHead>
            ))}
            <TableHead className="w-10">
              <span className="sr-only">{t('mocks.colActions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </div>
  )
}
