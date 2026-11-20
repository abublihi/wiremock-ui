import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowLeftIcon, CircleDotIcon, InboxIcon } from 'lucide-react'
import { ApiError } from '@/ui/api/client'
import { useRecording, useRecordingState, useRecordings } from '@/ui/api/queries'
import { LiveDot } from '@/ui/components/common/LiveDot'
import { RecordPanel, SnapshotPanel } from '@/ui/components/recording/RecordForms'
import { ReviewList } from '@/ui/components/recording/ReviewList'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs'
import { useRecordingAllowed } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { relativeTime } from '@/ui/lib/time'

export type RecordingTab = 'record' | 'snapshot' | 'review'
export type RecordingSearch = { tab?: RecordingTab; review?: string }

export const Route = createFileRoute('/_app/recording')({
  validateSearch: (raw: Record<string, unknown>): RecordingSearch => ({
    tab: raw.tab === 'record' || raw.tab === 'snapshot' || raw.tab === 'review' ? raw.tab : undefined,
    review: typeof raw.review === 'string' && raw.review !== '' ? raw.review : undefined,
  }),
  component: RecordingRoute,
})

function RecordingRoute() {
  const search = Route.useSearch()
  return <RecordingPage search={search} />
}

const TAB =
  'px-3 text-xs data-active:border-signal/40 data-active:bg-signal/10 data-active:text-signal-fg dark:data-active:border-signal/40 dark:data-active:bg-signal/10 dark:data-active:text-signal-fg'

/** Record a real service, turn logged requests into mocks, and review what either produced (spec A12). */
export function RecordingPage({ search }: { search: RecordingSearch }) {
  const t = useT()
  const allowed = useRecordingAllowed()
  const navigate = useNavigate()
  const state = useRecordingState({ enabled: allowed })
  const lists = useRecordings({ enabled: allowed })
  const tab: RecordingTab = search.review ? 'review' : (search.tab ?? 'record')
  const recording = state.data?.status === 'recording'

  if (!allowed) {
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>{t('recording.title')}</AlertTitle>
        <AlertDescription>{t('recording.disabled')}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('recording.title')}</h1>
            <LiveDot active={recording} label={recording ? t('recording.live') : t('recording.idle')} />
          </div>
          <p className="text-xs text-muted-foreground">{t('recording.caption')}</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => void navigate({ to: '/recording', search: { tab: v as RecordingTab } })} className="gap-4">
        <TabsList aria-label={t('recording.title')} className="border border-line bg-surface-2">
          <TabsTrigger value="record" className={TAB}>
            {recording && <CircleDotIcon aria-hidden className="recording-pulse rounded-full text-mismatch" />}
            {t('recording.tabRecord')}
          </TabsTrigger>
          <TabsTrigger value="snapshot" className={TAB}>
            {t('recording.tabSnapshot')}
          </TabsTrigger>
          <TabsTrigger value="review" className={TAB}>
            {t('recording.tabReview', { count: lists.data?.length ?? 0 })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="record">
          <RecordPanel state={state.data} />
        </TabsContent>
        <TabsContent value="snapshot">
          <SnapshotPanel />
        </TabsContent>
        <TabsContent value="review">
          {search.review ? <OneList id={search.review} /> : <AllLists />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function OneList({ id }: { id: string }) {
  const t = useT()
  const one = useRecording(id)
  const recording = one.data
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/recording" search={{ tab: 'review' }}>
            <ArrowLeftIcon data-icon="inline-start" />
            {t('recording.backToLists')}
          </Link>
        </Button>
      </div>
      {one.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : recording ? (
        // Keyed so a different list starts with fresh selections.
        <ReviewList key={recording.id} recording={recording} />
      ) : (
        <Alert>
          <AlertCircleIcon />
          <AlertDescription>{one.error instanceof ApiError && one.error.status === 404 ? t('recording.reviewMissing') : (one.error?.message ?? t('recording.reviewMissing'))}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function AllLists() {
  const t = useT()
  const lists = useRecordings()
  if (lists.isPending) return <Skeleton className="h-24 w-full" />
  if (lists.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertDescription>{lists.error.message}</AlertDescription>
      </Alert>
    )
  }
  if (lists.data.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed border-line">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>{t('recording.listsEmptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('recording.listsEmptyBody')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="stagger-children flex flex-col gap-3">
      {lists.data.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium break-all">
              {r.kind === 'recording' ? `${t('recording.listRecording')} ${r.target ?? '?'}` : t('recording.listSnapshot')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(r.itemCount === 1 ? 'recording.listMetaOne' : 'recording.listMeta', {
                count: r.itemCount,
                name: r.createdBy,
                when: relativeTime(r.createdAt),
                expires: relativeTime(r.expiresAt),
              })}
            </p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/recording" search={{ review: r.id }}>
              {t('recording.openReview')}
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  )
}
