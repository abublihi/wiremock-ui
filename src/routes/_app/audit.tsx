import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, ScrollTextIcon } from 'lucide-react'
import type { AuditFilter } from '@/server/audit/view'
import { useAudit } from '@/ui/api/queries'
import { AuditFilters } from '@/ui/components/admin/AuditFilters'
import { AuditTable, AuditTableSkeleton } from '@/ui/components/admin/AuditTable'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT } from '@/ui/i18n'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)
const day = (v: unknown) => (typeof v === 'string' && DAY.test(v) ? v : undefined)

export const Route = createFileRoute('/_app/audit')({
  validateSearch: (raw: Record<string, unknown>): AuditFilter => ({
    actor: text(raw.actor),
    action: text(raw.action),
    from: day(raw.from),
    to: day(raw.to),
  }),
  component: AuditRoute,
})

function AuditRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const onSearchChange = useCallback((next: AuditFilter) => void navigate({ search: next, replace: true }), [navigate])
  return <AuditPage search={search} onSearchChange={onSearchChange} />
}

/** Drops unset filters, so the query key and the URL stay stable. */
const defined = (f: AuditFilter): AuditFilter => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined))

export function AuditPage({ search = {}, onSearchChange }: { search?: AuditFilter; onSearchChange?: (next: AuditFilter) => void }) {
  const t = useT()
  const filter = defined(search)
  const filtered = Object.keys(filter).length > 0
  const audit = useAudit(filter)
  const scanLimited = audit.data?.pages.some((p) => p.scanLimitReached) ?? false
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? []
  return (
    <div className="fade-up flex flex-col gap-5">
      <header>
        <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('audit.title')}</h1>
        <p className="text-xs text-muted-foreground">
          {audit.data
            ? t(audit.hasNextPage ? 'audit.captionMore' : entries.length === 1 ? 'audit.captionOne' : 'audit.caption', { count: entries.length })
            : '//'}
        </p>
      </header>

      {onSearchChange && <AuditFilters filter={filter} onChange={(next) => onSearchChange(defined(next))} />}

      {audit.isPending ? (
        <AuditTableSkeleton />
      ) : audit.isError && !audit.data ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('audit.loadFailed')}</AlertTitle>
          <AlertDescription>
            <p>{audit.error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void audit.refetch()}>
              {t('audit.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollTextIcon />
            </EmptyMedia>
            <EmptyTitle>{t(filtered ? 'audit.emptyFilteredTitle' : 'audit.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t(filtered ? 'audit.emptyFiltered' : 'audit.emptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <AuditTable entries={entries} />
          {scanLimited && <p className="text-xs text-muted-foreground">{t('audit.scanLimit')}</p>}
          {audit.isFetchNextPageError && (
            <p role="alert" className="flex items-center gap-2 text-xs text-mismatch">
              <AlertCircleIcon className="size-3.5" />
              {t('audit.loadMoreFailed', { message: audit.error?.message ?? '' })}
            </p>
          )}
          {audit.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
                {audit.isFetchingNextPage && <Spinner data-icon="inline-start" />}
                {t(audit.isFetchingNextPage ? 'audit.loadingMore' : 'audit.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
