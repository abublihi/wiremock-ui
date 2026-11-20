import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRightIcon, TriangleAlertIcon } from 'lucide-react'
import type { Scenario } from '@/server/scenarios/service'
import { LiveDot } from '@/ui/components/common/LiveDot'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Switch } from '@/ui/components/ui/switch'
import { useT } from '@/ui/i18n'
import { STARTED, type ScenarioForm, isScenarioNameSettable } from '@/ui/lib/editor-sync'
import { cn } from '@/ui/lib/utils'

export type ScenarioErrors = Partial<Record<'name' | 'requiredState' | 'newState', string>>

/** Suggestions shown under a field: at most this many, the ones containing what was typed first. */
const MAX_SUGGESTIONS = 8

function suggest(options: string[], typed: string): string[] {
  const value = typed.trim()
  const q = value.toLowerCase()
  const unique = [...new Set(options)]
  // A field already holding one of the options (say "Started") offers the others; otherwise filter by what was typed.
  const exact = unique.includes(value)
  const others = unique.filter((o) => o !== value)
  const hits = q && !exact ? others.filter((o) => o.toLowerCase().includes(q)) : others
  return hits.slice(0, MAX_SUGGESTIONS)
}

/**
 * "Scenario (stateful)": a switch that opens the scenario name (pick an existing one or type a new one), the state
 * the mock answers in, and the state it moves the scenario to.
 */
export function ScenarioSection({
  scenario,
  existing,
  selfId,
  errors,
  onChange,
}: {
  scenario: ScenarioForm
  /** The scenarios other mocks already use (names and their states), for the suggestions. */
  existing: Scenario[]
  /** The mock being edited, left out of the "joins a scenario N mocks use" count. */
  selfId?: string
  errors: ScenarioErrors
  onChange: (patch: Partial<ScenarioForm>) => void
}) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const described = (name: keyof ScenarioErrors, ...extra: (string | false)[]) =>
    [...extra, errors[name] && id(`${name}-error`)].filter(Boolean).join(' ') || undefined
  const error = (name: keyof ScenarioErrors) => (errors[name] ? <FieldError id={id(`${name}-error`)}>{errors[name]}</FieldError> : null)

  const name = scenario.name.trim()
  const known = existing.find((s) => s.name === name)
  const others = known ? known.mocks.filter((m) => m.id !== selfId).length : 0
  const states = [STARTED, ...(known?.possibleStates ?? [])]
  const unsettable = name !== '' && !isScenarioNameSettable(name)

  return (
    <div className="flex flex-col gap-5">
      <Field orientation="horizontal">
        <Switch
          id={id('on')}
          checked={scenario.enabled}
          aria-controls={scenario.enabled ? id('fields') : undefined}
          onCheckedChange={(enabled) => onChange({ enabled })}
        />
        <div className="flex flex-col gap-0.5">
          <FieldLabel htmlFor={id('on')}>{t('editor.scenario.toggle')}</FieldLabel>
          <FieldDescription className="text-xs">{t('editor.scenario.toggleHint')}</FieldDescription>
        </div>
      </Field>

      {scenario.enabled && (
        <div id={id('fields')} className="fade-up flex flex-col gap-5 border-s-2 border-signal/30 ps-4">
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor={id('name')}>{t('editor.scenario.name')}</FieldLabel>
            <Input
              id={id('name')}
              dir="ltr"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="order-status"
              value={scenario.name}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={described('name', id('name-hint'), unsettable && id('name-warn'))}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <Suggestions
              label={t('editor.scenario.existing')}
              options={suggest(
                existing.map((s) => s.name),
                scenario.name,
              )}
              onPick={(picked) => onChange({ name: picked })}
            />
            <FieldDescription id={id('name-hint')} className="text-xs">
              {others > 0
                ? t(others === 1 ? 'editor.scenario.joinsOne' : 'editor.scenario.joins', { count: others })
                : t('editor.scenario.nameHint')}
            </FieldDescription>
            {known && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t('scenarios.nowIn')}
                <LiveDot label={known.state} className="normal-case tracking-normal" />
                <Link
                  to="/scenarios"
                  search={{ scenario: known.name }}
                  className="inline-flex items-center gap-1 text-signal-fg hover:underline"
                >
                  {t('editor.scenario.open')}
                  <ArrowUpRightIcon aria-hidden className="size-3" />
                </Link>
              </p>
            )}
            {unsettable && (
              <p id={id('name-warn')} className="flex items-start gap-1.5 text-xs text-hazard-fg">
                <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                {t('editor.scenario.unsettable')}
              </p>
            )}
            {error('name')}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.requiredState)}>
              <FieldLabel htmlFor={id('required')}>{t('editor.scenario.requiredState')}</FieldLabel>
              <Input
                id={id('required')}
                dir="ltr"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder={STARTED}
                value={scenario.requiredState}
                aria-invalid={Boolean(errors.requiredState)}
                aria-describedby={described('requiredState', id('required-hint'))}
                onChange={(e) => onChange({ requiredState: e.target.value })}
              />
              <Suggestions
                label={t('editor.scenario.knownStates')}
                options={suggest(states, scenario.requiredState)}
                onPick={(picked) => onChange({ requiredState: picked })}
              />
              <FieldDescription id={id('required-hint')} className="text-xs">
                {t('editor.scenario.requiredHint')}
              </FieldDescription>
              {error('requiredState')}
            </Field>
            <Field data-invalid={Boolean(errors.newState)}>
              <FieldLabel htmlFor={id('new')}>
                {t('editor.scenario.newState')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
              </FieldLabel>
              <Input
                id={id('new')}
                dir="ltr"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder="shipped"
                value={scenario.newState}
                aria-invalid={Boolean(errors.newState)}
                aria-describedby={described('newState', id('new-hint'))}
                onChange={(e) => onChange({ newState: e.target.value })}
              />
              <Suggestions
                label={t('editor.scenario.knownStates')}
                options={suggest(states, scenario.newState)}
                onPick={(picked) => onChange({ newState: picked })}
              />
              <FieldDescription id={id('new-hint')} className="text-xs">
                {t('editor.scenario.newHint')}
              </FieldDescription>
              {error('newState')}
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}

/** Small pick-me chips under a free-text field ("pick existing or type new"). */
function Suggestions({ label, options, onPick }: { label: string; options: string[]; onPick: (value: string) => void }) {
  if (options.length === 0) return null
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onPick(option)}
          className={cn(
            'max-w-full truncate rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors',
            'hover:border-signal/40 hover:text-signal-fg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
