import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, PlusIcon, RotateCcwIcon, WorkflowIcon } from 'lucide-react'
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
import { useT } from '@/ui/i18n'

export type ScenariosSearch = { scenario?: string }

export const Route = createFileRoute('/_app/scenarios/')({
  validateSearch: (raw: Record<string, unknown>): ScenariosSearch => ({
    scenario: typeof raw.scenario === 'string' && raw.scenario !== '' ? raw.scenario : undefined,
  }),
  component: ScenariosRoute,
})

function ScenariosRoute() {
  const { scenario } = Route.useSearch()
  return <ScenariosPage focus={scenario} />
}

/**
 * Stateful mocks grouped by scenario, with each one's live state (polled while the page is visible).
 * `focus` names a scenario to scroll to and highlight (the editor's "Open in Scenarios").
 */
export function ScenariosPage({ focus }: { focus?: string } = {}) {
  const t = useT()
  const visible = useDocumentVisible()
  const scenarios = useScenarios({ live: true })
  const list = scenarios.data ?? []

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
        <ScenarioList scenarios={list} focus={focus} />
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
