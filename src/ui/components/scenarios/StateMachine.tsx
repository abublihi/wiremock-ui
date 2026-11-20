import { Link } from '@tanstack/react-router'
import { CrosshairIcon } from 'lucide-react'
import type { Scenario, ScenarioMock } from '@/server/scenarios/service'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { LiveDot } from '@/ui/components/common/LiveDot'
import { Button } from '@/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'

/** Where each of a scenario's mocks goes in the diagram. */
export type Layout = {
  /** Mocks that answer in a state and leave it there (or move it to itself): a small loop on that state's box. */
  loops: Map<string, ScenarioMock[]>
  /** Mocks that move the scenario from state i to state i + 1: the arrow between the two boxes (keyed by i). */
  steps: Map<number, ScenarioMock[]>
  /** Every other move (back, skipping ahead, or from any state): an arrow of its own under the boxes. */
  jumps: { from: string | null; to: string; mock: ScenarioMock }[]
  /** Mocks that answer in any state and leave it there. */
  anyState: ScenarioMock[]
}

/** Sorts a scenario's mocks into loops, steps between neighbouring states, and other jumps. Pure (tested). */
export function layoutScenario(scenario: Pick<Scenario, 'possibleStates' | 'mocks'>): Layout {
  const index = new Map(scenario.possibleStates.map((s, i) => [s, i]))
  const layout: Layout = { loops: new Map(), steps: new Map(), jumps: [], anyState: [] }
  const push = <K,>(map: Map<K, ScenarioMock[]>, key: K, mock: ScenarioMock) => map.set(key, [...(map.get(key) ?? []), mock])
  for (const mock of scenario.mocks) {
    const from = mock.requiredState
    const to = mock.newState
    if (from === undefined) {
      if (to === undefined) layout.anyState.push(mock)
      else layout.jumps.push({ from: null, to, mock })
    } else if (to === undefined || to === from) push(layout.loops, from, mock)
    else if (index.get(to) === (index.get(from) ?? -2) + 1) push(layout.steps, index.get(from)!, mock)
    else layout.jumps.push({ from, to, mock })
  }
  return layout
}

/**
 * A scenario's states as boxes in transition order (a row on wide cards, a column on narrow ones) with its mocks
 * as labelled arrows between them; the current state is highlighted. `onSetState` moves the scenario; without it the
 * diagram is a preview (the scenario builder's): no "Set as current", and the mock labels are not links.
 */
export function StateMachine({
  scenario,
  busy,
  onSetState,
}: {
  scenario: Scenario
  busy?: boolean
  onSetState?: (state: string) => void
}) {
  const t = useT()
  const linked = onSetState !== undefined
  const layout = layoutScenario(scenario)
  const states = scenario.possibleStates
  return (
    <div className="@container/diagram flex flex-col gap-4">
      <ol
        aria-label={t('scenarios.statesLabel', { name: scenario.name })}
        className="flex flex-col items-stretch @2xl/diagram:flex-row @2xl/diagram:items-stretch @2xl/diagram:overflow-x-auto @2xl/diagram:pb-1"
      >
        {states.map((state, i) => (
          <li key={state} className="flex flex-col @2xl/diagram:flex-row">
            <StateBox
              state={state}
              current={state === scenario.state}
              loops={layout.loops.get(state) ?? []}
              settable={scenario.settable}
              busy={busy ?? false}
              onSet={onSetState && (() => onSetState(state))}
            />
            {i < states.length - 1 && <Step mocks={layout.steps.get(i) ?? []} linked={linked} />}
          </li>
        ))}
      </ol>

      {(layout.jumps.length > 0 || layout.anyState.length > 0) && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t('scenarios.otherMoves')}</p>
          <ul className="flex flex-col gap-2">
            {layout.jumps.map(({ from, to, mock }) => (
              <li key={mock.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface-2/60 px-3 py-2">
                <span className="flex items-center gap-2 font-mono text-xs">
                  <span className={cn(from === null && 'text-muted-foreground italic')}>{from ?? t('scenarios.anyState')}</span>
                  <Arrow direction="right" className="w-10 text-signal" />
                  <span>{to}</span>
                </span>
                <MockLabel mock={mock} linked={linked} />
              </li>
            ))}
            {layout.anyState.map((mock) => (
              <li key={mock.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface-2/60 px-3 py-2">
                <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground italic">
                  {t('scenarios.anyState')}
                  <LoopGlyph />
                </span>
                <MockLabel mock={mock} linked={linked} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StateBox({
  state,
  current,
  loops,
  settable,
  busy,
  onSet,
}: {
  state: string
  current: boolean
  loops: ScenarioMock[]
  settable: boolean
  busy: boolean
  /** Undefined in a preview: no "Set as current". */
  onSet?: () => void
}) {
  const t = useT()
  const set = (
    <Button variant="ghost" size="xs" disabled={!settable || busy} onClick={onSet} aria-label={t('scenarios.setAsCurrentNamed', { state })}>
      <CrosshairIcon data-icon="inline-start" />
      {t('scenarios.setAsCurrent')}
    </Button>
  )
  return (
    <div
      aria-current={current ? 'step' : undefined}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 transition-[border-color,background-color,box-shadow] duration-300 @2xl/diagram:w-52 @2xl/diagram:shrink-0',
        current
          ? 'border-signal/60 bg-signal/8 shadow-[0_0_0_1px_color-mix(in_oklab,var(--signal)_25%,transparent),0_0_24px_-6px_var(--signal)]'
          : 'border-line bg-surface-2/60',
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span dir="ltr" className={cn('truncate font-mono text-sm font-semibold', current && 'text-signal-fg')} title={state}>
          {state}
        </span>
        {current && <LiveDot label={t('scenarios.current')} className="shrink-0" />}
      </div>
      {loops.length > 0 && (
        <ul aria-label={t('scenarios.staysLabel', { state })} className="flex flex-col gap-1.5 border-t border-line/70 pt-2">
          {loops.map((mock) => (
            <li key={mock.id} className="flex min-w-0 items-start gap-1.5">
              <LoopGlyph />
              <MockLabel mock={mock} linked={Boolean(onSet)} />
            </li>
          ))}
        </ul>
      )}
      {!current && onSet && (
        <div className="-ms-2 mt-auto">
          {settable ? (
            set
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button gets no pointer events; the wrapper carries the tooltip and focus. */}
                <span tabIndex={0} className="inline-flex rounded-md">
                  {set}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{t('scenarios.notSettable')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}

/** The arrow from one state to the next, labelled with the mocks that make that move. */
function Step({ mocks, linked }: { mocks: ScenarioMock[]; linked: boolean }) {
  const t = useT()
  return (
    <div className="flex min-h-12 items-stretch gap-3 ps-5 @2xl/diagram:min-w-40 @2xl/diagram:max-w-64 @2xl/diagram:flex-col @2xl/diagram:items-stretch @2xl/diagram:justify-center @2xl/diagram:gap-1 @2xl/diagram:px-2 @2xl/diagram:py-0">
      <Arrow direction="down" className={cn('w-3 shrink-0 @2xl/diagram:hidden', mocks.length > 0 ? 'text-signal' : 'text-line')} />
      <ul aria-label={mocks.length > 0 ? t('scenarios.movesLabel') : undefined} className="flex min-w-0 flex-col justify-center gap-1 py-2 @2xl/diagram:order-first @2xl/diagram:py-0">
        {mocks.map((mock) => (
          <li key={mock.id} className="min-w-0">
            <MockLabel mock={mock} linked={linked} />
          </li>
        ))}
      </ul>
      <Arrow direction="right" className={cn('hidden h-3 @2xl/diagram:block', mocks.length > 0 ? 'text-signal' : 'text-line')} />
    </div>
  )
}

/** A shaft and head that stretch along the connector (inline SVG; the head keeps its shape at any length). */
function Arrow({ direction, className }: { direction: 'right' | 'down'; className?: string }) {
  const right = direction === 'right'
  return (
    <svg aria-hidden className={cn(right ? 'h-3 w-full' : 'h-full min-h-8 w-3', 'overflow-visible', className)}>
      {right ? (
        <>
          <line x1="0" y1="50%" x2="100%" y2="50%" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          <svg x="100%" y="50%" overflow="visible">
            <path d="M-7 -4.5 L0 0 L-7 4.5 Z" fill="currentColor" />
          </svg>
        </>
      ) : (
        <>
          <line x1="50%" y1="0" x2="50%" y2="100%" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          <svg x="50%" y="100%" overflow="visible">
            <path d="M-4.5 -7 L0 0 L4.5 -7 Z" fill="currentColor" />
          </svg>
        </>
      )}
    </svg>
  )
}

/** A small loop: the mock answers and the scenario stays in this state. */
function LoopGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0 text-signal">
      <path d="M11.5 4.2A5 5 0 1 0 13 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13.6 1.8 L13.2 5.4 L9.8 4.6 Z" fill="currentColor" />
    </svg>
  )
}

/** A mock as an arrow label: its name (a link to it, unless `linked` is false), method and URL. */
function MockLabel({ mock, linked }: { mock: ScenarioMock; linked: boolean }) {
  const t = useT()
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {linked ? (
        <Link
          to="/mocks/$id"
          params={{ id: mock.id }}
          className="truncate text-xs font-medium hover:text-signal-fg hover:underline"
          title={mock.name ?? mock.id}
        >
          {mock.name ?? t('scenarios.unnamedMock')}
        </Link>
      ) : (
        <span className="truncate text-xs font-medium">{mock.name ?? t('scenarios.unnamedMock')}</span>
      )}
      {(mock.method || mock.url) && (
        <span className="flex min-w-0 items-center gap-1.5">
          {mock.method && <MethodBadge method={mock.method} className="h-4 px-1 text-[9px]" />}
          {mock.url && (
            <span dir="ltr" className="truncate font-mono text-[10px] text-muted-foreground" title={mock.url}>
              {mock.url}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
