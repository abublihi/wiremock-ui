import { createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, ScrollTextIcon } from 'lucide-react'
import { useAudit } from '@/ui/api/queries'
import { AuditTable, AuditTableSkeleton } from '@/ui/components/admin/AuditTable'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT } from '@/ui/i18n'

export const Route = createFileRoute('/_app/audit')({ component: AuditPage })

export function AuditPage() {
  const t = useT()
  const audit = useAudit()
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
            <EmptyTitle>{t('audit.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('audit.emptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <AuditTable entries={entries} />
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
