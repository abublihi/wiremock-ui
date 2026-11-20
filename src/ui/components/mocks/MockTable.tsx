import { Link } from '@tanstack/react-router'
import { WebhookIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Badge } from '@/ui/components/ui/badge'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { relativeTime } from '@/ui/lib/time'
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

const hasWebhook = (stub: StubMapping) =>
  Array.isArray(stub.serveEventListeners) &&
  stub.serveEventListeners.some((l: unknown) => typeof l === 'object' && l !== null && (l as { name?: unknown }).name === 'webhook')

/** In place of a status: WireMock forwards the request, so the real service picks the status. */
function ProxyBadge({ url }: { url: string }) {
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex h-5 shrink-0 cursor-default items-center rounded-sm border border-dashed border-signal/45 px-1.5 font-mono text-[10px] font-semibold tracking-wider text-signal-fg uppercase"
        >
          {t('mocks.proxy')}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span dir="ltr" className="font-mono">
          {t('mocks.proxyHint', { url })}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function WebhookMark() {
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="ms-1.5 inline-flex cursor-default align-[-2px] text-muted-foreground hover:text-signal-fg">
          <WebhookIcon aria-hidden className="size-3.5" />
          <span className="sr-only">{t('mocks.webhook')}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent aria-hidden>{t('mocks.webhook')}</TooltipContent>
    </Tooltip>
  )
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
          const proxyUrl = typeof stub.response.proxyBaseUrl === 'string' ? stub.response.proxyBaseUrl : undefined
          const owner = meta?.owner ?? 'baseline'
          return (
            <TableRow key={stub.id} className="hover:bg-surface-2">
              <TableCell className="max-w-28 whitespace-normal md:max-w-64">
                <Link to="/mocks/$id" params={{ id: stub.id }} className="font-medium hover:text-signal-fg hover:underline">
                  {stub.name || t('mocks.unnamed')}
                </Link>
                {hasWebhook(stub) && <WebhookMark />}
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
                {proxyUrl !== undefined ? <ProxyBadge url={proxyUrl} /> : <StatusBadge status={status} />}
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
