import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertCircleIcon, PlusIcon, RotateCcwIcon, SearchIcon, SearchXIcon, WorkflowIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useDocumentVisible, useResetScenarios, useScenarios } from '@/ui/api/queries'
import { LiveDot } from '@/ui/components/common/LiveDot'
import { ScenarioList, ScenarioListSkeleton } from '@/ui/components/scenarios/ScenarioList'
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { WithTerm } from '@/ui/components/guide/Term'
import { Input } from '@/ui/components/ui/input'
import { MockPager } from '@/ui/components/mocks/MockPager'
import { useT } from '@/ui/i18n'
import { SCENARIOS_PAGE_SIZE, filterScenarios, pageCount, pageOf } from '@/ui/lib/scenarios-page'

/** `scenario`: a card to show and highlight; `q`: the search; `page`: 2 and up (page 1 is left out of the URL). */
export type ScenariosSearch = { scenario?: string; q?: string; page?: number }

export const Route = createFileRoute('/_app/scenarios/')({
  validateSearch: (raw: Record<string, unknown>): ScenariosSearch => {
    const page = Number(raw.page)
    const q = typeof raw.q === 'number' ? String(raw.q) : raw.q
    return {
      scenario: typeof raw.scenario === 'string' && raw.scenario !== '' ? raw.scenario : undefined,
      q: typeof q === 'string' && q !== '' ? q : undefined,
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    }
  },
  component: ScenariosRoute,
})

function ScenariosRoute() {
  return <ScenariosPage />
}

const SEARCH_DEBOUNCE_MS = 250

/**
 * Stateful mocks grouped by scenario, with each one's live state (polled while the page is visible).
 * `focus` names a scenario to scroll to and highlight (the editor's "Open in Scenarios").
 */
export function ScenariosPage({ focus: focusProp }: { focus?: string } = {}) {
  const t = useT()
  const visible = useDocumentVisible()
  const scenarios = useScenarios({ live: true })
  const list = scenarios.data ?? []
  const search = useSearch({ strict: false }) as ScenariosSearch
  const navigate = useNavigate()
  const setSearch = (patch: ScenariosSearch, replace = true) =>
    void navigate({ to: '.', search: ((prev: ScenariosSearch) => ({ ...prev, ...patch })) as never, replace })
  const focus = focusProp ?? search.scenario
  const q = search.q ?? ''
  const page = search.page ?? 1

  // The box follows the URL (back/forward); typing updates the URL after a short pause, back on page 1.
  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])
  useEffect(() => {
    if (draft === q) return
    const timer = setTimeout(() => setSearch({ q: draft || undefined, page: undefined }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, q])

  const matches = filterScenarios(list, q)
  const pages = pageCount(matches.length)
  const shown = matches.slice((page - 1) * SCENARIOS_PAGE_SIZE, page * SCENARIOS_PAGE_SIZE)

  // ?scenario=name lands on the page that holds it, clearing a search that hides it (once per name).
  const landed = useRef<string | undefined>(undefined)
  const landing = Boolean(focus && scenarios.data && landed.current !== focus)
  useEffect(() => {
    if (!focus || !scenarios.data || landed.current === focus) return
    landed.current = focus
    const inMatches = pageOf(matches, focus)
    if (inMatches !== undefined) {
      if (inMatches !== page) setSearch({ page: inMatches > 1 ? inMatches : undefined })
      return
    }
    const inAll = pageOf(list, focus)
    if (inAll !== undefined) setSearch({ q: undefined, page: inAll > 1 ? inAll : undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, scenarios.data])
  // A page past the end (scenarios deleted, an old link): the last page that has cards.
  const pastEnd = Boolean(scenarios.data && !landing && page > pages)
  useEffect(() => {
    if (pastEnd) setSearch({ page: pages > 1 ? pages : undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastEnd, pages])

  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('scenarios.title')}</h1>
            <LiveDot active={visible && !scenarios.isError} label={visible ? t('scenarios.live') : t('scenarios.pausedHidden')} />
          </div>
          <p className="text-xs text-muted-foreground">
            {scenarios.data ? <WithTerm text={t(list.length === 1 ? 'scenarios.captionOne' : 'scenarios.caption', { count: list.length })} word="state" name="scenario state" /> : '//'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {list.length > 0 && <ResetAllButton />}
          <Button asChild size="sm">
            <Link to="/scenarios/new">
              <PlusIcon data-icon="inline-start" />
              {t('scenarios.new')}
            </Link>
          </Button>
        </div>
      </header>

      {scenarios.isError && scenarios.data && (
        <p role="alert" className="flex items-center gap-2 text-xs text-mismatch">
          <AlertCircleIcon className="size-3.5" />
          {t('scenarios.refreshFailed', { message: scenarios.error.message })}
          <Button variant="ghost" size="xs" onClick={() => void scenarios.refetch()}>
            {t('scenarios.retry')}
          </Button>
        </p>
      )}

      {scenarios.isPending ? (
        <ScenarioListSkeleton />
      ) : scenarios.isError && !scenarios.data ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('scenarios.loadFailed')}</AlertTitle>
          <AlertDescription>
            <p>{scenarios.error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void scenarios.refetch()}>
              {t('scenarios.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : list.length === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WorkflowIcon />
            </EmptyMedia>
            <EmptyTitle>{t('scenarios.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('scenarios.emptyBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/scenarios/new">
                <PlusIcon data-icon="inline-start" />
                {t('scenarios.create')}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="relative max-w-md">
            <SearchIcon aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label={t('scenarios.search')}
              placeholder={t('scenarios.searchPlaceholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="ps-8"
            />
          </div>
          {matches.length === 0 ? (
            <Empty className="rounded-md border border-dashed border-line">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>{t('scenarios.noMatchTitle', { q })}</EmptyTitle>
                <EmptyDescription>{t('scenarios.noMatchBody')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setSearch({ q: undefined, page: undefined })}>
                  {t('scenarios.clearSearch')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <ScenarioList scenarios={shown} focus={focus} live={visible && !scenarios.isError} stale={scenarios.isError} />
              {matches.length > SCENARIOS_PAGE_SIZE && (
                <MockPager
                  page={Math.min(page, pages)}
                  size={SCENARIOS_PAGE_SIZE}
                  total={matches.length}
                  onPage={(next) => setSearch({ page: next > 1 ? next : undefined }, false)}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function ResetAllButton() {
  const t = useT()
  const reset = useResetScenarios()
  const [open, setOpen] = useState(false)
  const confirm = async () => {
    try {
      await reset.mutateAsync(undefined)
      toast.success(t('scenarios.resetAllDone'))
    } catch (error) {
      toast.error(t('scenarios.resetAllFailed'), { description: error instanceof Error ? error.message : undefined })
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={reset.isPending}>
          <RotateCcwIcon data-icon="inline-start" />
          {t('scenarios.resetAll')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="glass-panel">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('scenarios.resetAllTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('scenarios.resetAllBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>{t('scenarios.resetAll')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
