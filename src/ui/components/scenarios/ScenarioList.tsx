import { useEffect, useRef } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Scenario } from '@/server/scenarios/service'
import { useResetScenarios, useSetScenarioState } from '@/ui/api/queries'
import { LiveDot } from '@/ui/components/common/LiveDot'
import { Button } from '@/ui/components/ui/button'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { StateMachine } from './StateMachine'

/** One card per scenario: its name, live state, Reset, and the state diagram. */
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
      </header>
      <StateMachine scenario={scenario} busy={busy} onSetState={(state) => void onSetState(state)} />
    </article>
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
