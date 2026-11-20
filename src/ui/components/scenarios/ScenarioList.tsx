import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { Scenario } from '@/server/scenarios/service'
import type { StubMapping } from '@/server/wiremock/types'
import { apiFetch } from '@/ui/api/client'
import { queryKeys, useDeleteMock, useResetScenarios, useSetScenarioState } from '@/ui/api/queries'
import { LiveDot } from '@/ui/components/common/LiveDot'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
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
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { nextStateName } from '@/ui/lib/scenario-builder'
import { StateMachine } from './StateMachine'

/** One card per scenario: its name, live state, Edit, Add a mock, Reset, Delete, and the state diagram. */
export function ScenarioList({ scenarios, focus }: { scenarios: Scenario[]; focus?: string }) {
  return (
    <ul className="flex flex-col gap-4">
      {scenarios.map((scenario) => (
        <li key={scenario.name}>
          <ScenarioCard scenario={scenario} focused={scenario.name === focus} />
        </li>
      ))}
    </ul>
  )
}

function ScenarioCard({ scenario, focused }: { scenario: Scenario; focused: boolean }) {
  const t = useT()
  const ref = useRef<HTMLElement>(null)
  // Scroll the focused card into view once (not on every poll).
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'center' })
  }, [focused])
  const setState = useSetScenarioState()
  const reset = useResetScenarios()
  const busy = setState.isPending || reset.isPending
  const titleId = `scenario-${encodeURIComponent(scenario.name)}`
  // A new step comes after the scenario's last state (the end of its transition order) and answers in a new state.
  const lastState = scenario.possibleStates.at(-1) ?? 'Started'
  const nextState = nextStateName(scenario.possibleStates)

  const onSetState = async (state: string) => {
    try {
      await setState.mutateAsync({ name: scenario.name, state })
      toast.success(t('scenarios.moved', { name: scenario.name, state }))
    } catch (error) {
      toast.error(t('scenarios.setFailed', { name: scenario.name }), { description: error instanceof Error ? error.message : undefined })
    }
  }
  const onReset = async () => {
    try {
      await reset.mutateAsync(scenario.name)
      toast.success(t('scenarios.resetOne', { name: scenario.name }))
    } catch (error) {
      toast.error(t('scenarios.resetFailed', { name: scenario.name }), { description: error instanceof Error ? error.message : undefined })
    }
  }

  const resetButton = (
    <Button variant="outline" size="sm" disabled={busy || !scenario.settable} onClick={() => void onReset()}>
      <RotateCcwIcon data-icon="inline-start" />
      {t('scenarios.reset')}
    </Button>
  )

  return (
    <article
      ref={ref}
      aria-labelledby={titleId}
      data-focused={focused || undefined}
      className="glow-border flex scroll-mt-20 flex-col gap-4 rounded-md border border-line bg-surface p-4 data-focused:border-signal/50 data-focused:ring-1 data-focused:ring-signal/30 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p aria-hidden className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            — {t(scenario.mocks.length === 1 ? 'scenarios.mockCountOne' : 'scenarios.mockCount', { count: scenario.mocks.length })}
          </p>
          <h2 id={titleId} dir="ltr" className="font-mono text-base font-semibold break-all">
            {scenario.name}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t('scenarios.nowIn')}
            <LiveDot label={scenario.state} className="normal-case tracking-normal" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link to="/scenarios/$name/edit" params={{ name: scenario.name }}>
              <PencilIcon data-icon="inline-start" />
              {t('scenarios.edit')}
            </Link>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="outline" size="sm">
                <Link to="/mocks/new" search={{ scenario: scenario.name, state: nextState, after: lastState }}>
                  <PlusIcon data-icon="inline-start" />
                  {t('scenarios.addMock')}
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t('scenarios.addMockHint', { state: nextState, after: lastState })}</TooltipContent>
          </Tooltip>
          {scenario.settable ? (
            resetButton
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex rounded-md">
                  {resetButton}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{t('scenarios.notSettable')}</TooltipContent>
            </Tooltip>
          )}
          <DeleteScenarioButton scenario={scenario} />
        </div>
      </header>
      <StateMachine scenario={scenario} busy={busy} onSetState={(state) => void onSetState(state)} />
    </article>
  )
}

/** Deletes every mock of a scenario, after a confirm that lists them. */
function DeleteScenarioButton({ scenario }: { scenario: Scenario }) {
  const t = useT()
  const queryClient = useQueryClient()
  const deleteMock = useDeleteMock()
  const [busy, setBusy] = useState(false)
  const count = scenario.mocks.length
  // Listed in the order the scenario runs; any-state mocks last.
  const at = (state?: string) => (state === undefined ? scenario.possibleStates.length : scenario.possibleStates.indexOf(state))
  const listed = [...scenario.mocks].sort((a, b) => at(a.requiredState) - at(b.requiredState))
  const confirm = async () => {
    setBusy(true)
    try {
      // The current versions: a mock changed meanwhile is refused rather than deleted blind.
      const stubs = await apiFetch<StubMapping[]>('/api/mocks', { query: { scenario: scenario.name } })
      const left: string[] = []
      for (const stub of stubs) {
        try {
          await deleteMock.mutateAsync({ id: stub.id, version: stub.metadata?.wiremockUi?.version ?? 0 })
        } catch {
          left.push(stub.name ?? stub.id)
        }
      }
      if (left.length > 0) toast.error(t('scenarios.deleteFailed', { name: scenario.name, names: left.join(', ') }), { duration: Number.POSITIVE_INFINITY })
      else toast.success(t(stubs.length === 1 ? 'scenarios.deletedOne' : 'scenarios.deleted', { name: scenario.name, count: stubs.length }))
    } catch (error) {
      toast.error(t('scenarios.deleteFailed', { name: scenario.name, names: t('scenarios.deleteAll') }), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.scenarios })
      setBusy(false)
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy} className="text-mismatch hover:text-mismatch">
          <Trash2Icon data-icon="inline-start" />
          {t('scenarios.delete')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="glass-panel">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('scenarios.deleteTitle', { name: scenario.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t(count === 1 ? 'scenarios.deleteBodyOne' : 'scenarios.deleteBody', { count })}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul aria-label={t('scenarios.deleteList')} className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-xs">
          {listed.map((mock) => (
            <li key={mock.id} className="flex min-w-0 items-center gap-2 rounded-sm border border-line/70 bg-surface-2 px-2 py-1.5">
              {mock.method && <MethodBadge method={mock.method} />}
              <span className="truncate font-medium">{mock.name || t('scenarios.unnamedMock')}</span>
              <span dir="ltr" className="ms-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                {mock.requiredState ?? t('scenarios.anyState')}
              </span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void confirm()}>
            {t(count === 1 ? 'scenarios.deleteConfirmOne' : 'scenarios.deleteConfirm', { count })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ScenarioListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 2 }, (_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-md" />
      ))}
    </div>
  )
}
