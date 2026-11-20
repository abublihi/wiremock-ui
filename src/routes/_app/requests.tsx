import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertCircleIcon, FileStackIcon, PauseIcon, PlayIcon, RadioTowerIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { type RequestFilter, useClearRequests, useDocumentVisible, useIntegrations, useOlderRequests, useRequests, useSnapshot } from '@/ui/api/queries'
import { useRecordingAllowed } from '@/ui/config'
import { emptyMessage } from '@/ui/components/recording/RecordForms'
import { WithTerm } from '@/ui/components/guide/Term'
import { markRequestLogSeen } from '@/ui/components/guide/GettingStarted'
import { LiveDot } from '@/ui/components/common/LiveDot'
import { CountTool } from '@/ui/components/requests/CountTool'
import { RequestDrawer } from '@/ui/components/requests/RequestDrawer'
import { RequestFilters, type RequestsSearch } from '@/ui/components/requests/RequestFilters'
import { RequestTable, RequestTableSkeleton, useFreshIds } from '@/ui/components/requests/RequestTable'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/ui/components/ui/alert-dialog'
import { Button } from '@/ui/components/ui/button'
import { Spinner } from '@/ui/components/ui/spinner'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { useT } from '@/ui/i18n'

export type { RequestsSearch }

// The router JSON-parses search values, so `?status=404` arrives as a number: accept strings and numbers.
const str = (v: unknown) => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return typeof v === 'string' && v !== '' ? v : undefined
}
const bool = (v: unknown) => (v === true || v === 'true' ? 'true' : v === false || v === 'false' ? 'false' : undefined)

export const Route = createFileRoute('/_app/requests')({
  validateSearch: (raw: Record<string, unknown>): RequestsSearch => ({
    integration: str(raw.integration),
    matched: bool(raw.matched),
    status: str(raw.status),
    q: str(raw.q),
    range: raw.range === '15m' || raw.range === '1h' ? raw.range : undefined,
    open: str(raw.open),
  }),
  component: RequestsRoute,
})

export function RequestsRoute() {
  const search = useSearch({ strict: false }) as RequestsSearch
  const navigate = useNavigate()
  const onSearchChange = useCallback(
    (next: RequestsSearch) =>
      void navigate({ to: '.', search: ((prev: RequestsSearch) => ({ ...prev, ...next })) as never, replace: true }),
    [navigate],
  )
  return <RequestsPage search={search} onSearchChange={onSearchChange} />
}

const WINDOW_MINUTES = { '15m': 15, '1h': 60 } as const

/** The live request log. `search` is the URL state; `onSearchChange` merges a patch into it (undefined clears a key). */
export function RequestsPage({ search, onSearchChange }: { search: RequestsSearch; onSearchChange: (next: RequestsSearch) => void }) {
  const t = useT()
  const [live, setLive] = useState(true)
  const visible = useDocumentVisible()
  // The Getting started checklist's last step: the request log was opened.
  useEffect(() => markRequestLogSeen(), [])
  const filter = useMemo<RequestFilter>(
    () => ({
      matched: search.matched,
      integration: search.integration,
      status: search.status,
      q: search.q,
      windowMinutes: search.range ? WINDOW_MINUTES[search.range] : undefined,
    }),
    [search.matched, search.integration, search.status, search.q, search.range],
  )
  const requests = useRequests(filter, { live })
  const integrations = useIntegrations()
  const filtered = Boolean(search.matched || search.integration || search.status || search.q || search.range)

  const live1 = requests.data ?? []
  // "Load older" pages sit below the live first page; live updates keep arriving on top.
  const older = useOlderRequests(filter, live1)
  const rows = older.rows
  const fresh = useFreshIds(live1, requests.isSuccess && !requests.isPlaceholderData, JSON.stringify(filter))
  const unmatched = rows.filter((r) => !r.matched).length
  const clearFilters = () =>
    onSearchChange({ matched: undefined, integration: undefined, status: undefined, q: undefined, range: undefined })
  const open = useCallback((id: string) => onSearchChange({ open: id }), [onSearchChange])

  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('requests.title')}</h1>
            <LiveDot
              active={live && visible && !requests.isError}
              label={live ? (visible ? t('requests.live') : t('requests.pausedHidden')) : t('requests.paused')}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {requests.data
              ? <WithTerm text={t(rows.length === 1 ? 'requests.captionOne' : 'requests.caption', { count: rows.length, unmatched })} word="without a match" name="no match" />
              : '//'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLive((v) => !v)}>
            {live ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            {live ? t('requests.pause') : t('requests.resume')}
          </Button>
          <CountTool />
          <CreateMocksButton ids={rows.map((r) => r.id)} />
          <ClearLogButton onCleared={older.reset} />
        </div>
      </header>

      <RequestFilters search={search} integrations={integrations.data ?? []} onChange={onSearchChange} />

      {requests.isError && requests.data && (
        <p role="alert" className="flex items-center gap-2 text-xs text-mismatch">
          <AlertCircleIcon className="size-3.5" />
          {t('requests.refreshFailed', { message: requests.error.message })}
          <Button variant="ghost" size="xs" onClick={() => void requests.refetch()}>
            {t('requests.retry')}
          </Button>
        </p>
      )}

      {requests.isPending ? (
        <RequestTableSkeleton />
      ) : requests.isError && !requests.data ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('requests.loadFailed')}</AlertTitle>
          <AlertDescription>
            <p>{requests.error?.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void requests.refetch()}>
              {t('requests.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RadioTowerIcon />
            </EmptyMedia>
            <EmptyTitle>{t(filtered ? 'requests.noMatchTitle' : 'requests.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t(filtered ? 'requests.noMatchBody' : 'requests.emptyBody')}</EmptyDescription>
          </EmptyHeader>
          {filtered && (
            <EmptyContent>
              <Button variant="outline" onClick={clearFilters}>
                {t('requests.clearFilters')}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <RequestTable rows={rows} fresh={fresh} selectedId={search.open} onOpen={open} />
          {older.more && (
            <div className="flex flex-col items-center gap-1.5">
              <Button variant="outline" size="sm" disabled={older.pending} onClick={() => void older.load()}>
                {older.pending && <Spinner data-icon="inline-start" />}
                {t('requests.loadOlder')}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t(older.loaded ? 'requests.olderHint' : 'requests.capped', { count: rows.length })}</p>
            </div>
          )}
          {older.loaded && !older.more && <p className="text-center text-xs text-muted-foreground">{t('requests.olderEnd')}</p>}
          {older.error && (
            <p role="alert" className="text-center text-xs text-mismatch">
              {t('requests.olderFailed', { message: older.error.message })}
            </p>
          )}
        </>
      )}

      <RequestDrawer id={search.open} onClose={() => onSearchChange({ open: undefined })} />
    </div>
  )
}

/** Turns the requests the log shows (its current filter) into a review list on the Recording page (spec A12). */
function CreateMocksButton({ ids }: { ids: string[] }) {
  const t = useT()
  const allowed = useRecordingAllowed()
  const snapshot = useSnapshot()
  const navigate = useNavigate()
  if (!allowed || ids.length === 0) return null
  const onClick = async () => {
    try {
      const result = await snapshot.mutateAsync({ ids })
      const { recording } = result
      if (!recording) {
        toast.info(t('recording.snapshotEmptyTitle'), { description: emptyMessage(result.empty, 'snapshot'), duration: 15_000 })
        return
      }
      toast.success(t(recording.items.length === 1 ? 'recording.snapshotDoneOne' : 'recording.snapshotDone', { count: recording.items.length }))
      void navigate({ to: '/recording', search: { review: recording.id } })
    } catch (error) {
      toast.error(t('recording.snapshotFailed'), { description: error instanceof Error ? error.message : undefined })
    }
  }
  return (
    <Button variant="outline" size="sm" disabled={snapshot.isPending} title={t('requests.toMocksTitle', { count: ids.length })} onClick={() => void onClick()}>
      <FileStackIcon data-icon="inline-start" />
      {t('requests.toMocks')}
    </Button>
  )
}

function ClearLogButton({ onCleared }: { onCleared: () => void }) {
  const t = useT()
  const clear = useClearRequests()
  const [open, setOpen] = useState(false)
  const confirm = async () => {
    try {
      await clear.mutateAsync()
      onCleared()
      toast.success(t('requests.cleared'))
    } catch (error) {
      toast.error(t('requests.clearFailed'), { description: error instanceof Error ? error.message : undefined })
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="hover:border-mismatch/50 hover:text-mismatch">
          <Trash2Icon data-icon="inline-start" />
          {t('requests.clear')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="glass-panel">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('requests.clearTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('requests.clearBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void confirm()}>
            {t('requests.clear')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
