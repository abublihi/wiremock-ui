import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { StubMapping } from '@/server/wiremock/types'
import {
  queryKeys,
  useCreateCatalogMock,
  useCreateMock,
  useDeleteMock,
  useEndpoints,
  useIntegrations,
  useScenarios,
} from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
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
} from '@/ui/components/ui/alert-dialog'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Spinner } from '@/ui/components/ui/spinner'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import { STARTED, exampleFor } from '@/ui/lib/editor-sync'
import {
  type BuilderDraft,
  type BuilderErrors,
  type BuilderStep,
  type CatalogRequest,
  type Message,
  type MoveTo,
  type StepField,
  hasErrors,
  moveStep,
  newStep,
  previewScenario,
  removeStep,
  stepState,
  targetOf,
  toCreates,
  validateDraft,
} from '@/ui/lib/scenario-builder'
import { CodeEditor } from '@/ui/components/editor/CodeEditor'
import { EditorShell, Eyebrow, backLinkClass } from '@/ui/components/editor/EditorShell'
import { EndpointPicker, keyLabel } from '@/ui/components/editor/EndpointPicker'
import { HeaderRows } from '@/ui/components/editor/HeaderRows'
import { StateMachine } from './StateMachine'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

type Picked = { integration: string; endpoint: string }

/**
 * "New scenario": one request and an ordered list of steps (state, answer, where it moves next), saved as one mock per
 * step through the usual create endpoints — all of them, or none (a refused step removes the ones made before it).
 */
export function ScenarioBuilder() {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scenarios = useScenarios()
  const createCatalog = useCreateCatalogMock()
  const createFree = useCreateMock()
  const deleteMock = useDeleteMock()

  const counter = useRef(2)
  const nextId = () => `step-${++counter.current}`
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<BuilderStep[]>(() => [newStep('step-1'), newStep('step-2')])
  const [kind, setKind] = useState<'catalog' | 'free'>('catalog')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [key, setKey] = useState({ isDefault: false, keyValue: '' })
  const [free, setFree] = useState({ method: 'GET', url: '' })
  const [touched, setTouched] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const integrations = useIntegrations()
  const endpoints = useEndpoints(picked?.integration)
  const integration = integrations.data?.find((i) => i.key === picked?.integration)
  const endpoint = endpoints.data?.find((e) => e.key === picked?.endpoint)

  const catalogRequest: CatalogRequest | null =
    integration && endpoint ? { kind: 'catalog', integration, endpoint, isDefault: key.isDefault || !endpoint.lookup, keyValue: key.keyValue } : null
  const draft: BuilderDraft = { name, request: kind === 'catalog' ? catalogRequest : { kind: 'free', ...free }, steps }
  const errors = validateDraft(draft)
  const shown: BuilderErrors = attempted ? errors : { steps: {}, ...(errors.name?.key === 'builder.nameUnsettable' ? { name: errors.name } : {}) }
  const msg = (m: Message | undefined) => (m ? t(m.key, m.vars) : undefined)
  const existing = scenarios.data?.find((s) => s.name === name.trim())

  // A newly picked endpoint fills the bodies the user has not written with its examples.
  const filledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!endpoint) return
    const ref = `${endpoint.integration}/${endpoint.key}`
    if (filledFor.current === ref) return
    filledFor.current = ref
    setKey({ isDefault: !endpoint.lookup, keyValue: '' })
    setSteps((all) =>
      all.map((s) => {
        if (s.body !== '' && !s.bodyFromExample) return s
        const example = exampleFor(endpoint, Number(s.status))
        return { ...s, body: example, bodyFromExample: example !== '' }
      }),
    )
  }, [endpoint])

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setTouched(true)
    setFailure(null)
  }
  const updateStep = (stepId: string, patch: Partial<BuilderStep>) => {
    setSteps((all) => all.map((s) => (s.id === stepId ? { ...s, ...patch } : s)))
    setTouched(true)
    setFailure(null)
  }
  const onStatus = (step: BuilderStep, status: string) => {
    const example = endpoint && kind === 'catalog' ? exampleFor(endpoint, Number(status)) : ''
    const refill = (step.bodyFromExample || step.body === '') && example !== ''
    updateStep(step.id, { status, ...(refill ? { body: example, bodyFromExample: true } : {}) })
  }

  // Reordering keeps keyboard focus on the button that was used (or its partner when it can't move further).
  const focusAfterMove = useRef<{ id: string; dir: 'up' | 'down' } | null>(null)
  useEffect(() => {
    const pending = focusAfterMove.current
    if (!pending) return
    focusAfterMove.current = null
    const button = (dir: string) => document.getElementById(id(`${pending.id}-${dir}`)) as HTMLButtonElement | null
    const same = button(pending.dir)
    ;(same && !same.disabled ? same : button(pending.dir === 'up' ? 'down' : 'up'))?.focus()
  })
  const move = (step: BuilderStep, dir: 'up' | 'down') => {
    const next = moveStep(steps, step.id, dir === 'up' ? -1 : 1)
    if (next === steps) return
    focusAfterMove.current = { id: step.id, dir }
    setSteps(next)
    setTouched(true)
    setAnnouncement(t('builder.moved', { n: next.findIndex((s) => s.id === step.id) + 1 }))
  }
  const remove = (step: BuilderStep, i: number) => {
    setSteps(removeStep(steps, step.id))
    setTouched(true)
    setAnnouncement(t('builder.removed', { n: i + 1 }))
    // Focus the step that took its place (or the one before), never the page top.
    const neighbour = steps[i + 1] ?? steps[i - 1]
    if (neighbour) requestAnimationFrame(() => document.getElementById(id(`${neighbour.id}-title`))?.focus())
  }
  const add = () => {
    const step = newStep(nextId())
    const example = endpoint && kind === 'catalog' ? exampleFor(endpoint, 200) : ''
    setSteps((all) => [...all, { ...step, body: example, bodyFromExample: example !== '' }])
    setTouched(true)
    requestAnimationFrame(() => document.getElementById(id(`${step.id}-state`))?.focus())
  }

  // Leaving with unsaved steps asks first.
  const dirtyRef = useRef(false)
  dirtyRef.current = touched || name !== '' || picked !== null
  const leaving = useRef(false)
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !leaving.current,
    enableBeforeUnload: () => dirtyRef.current && !leaving.current,
    withResolver: true,
  })

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setAttempted(true)
    setFailure(null)
    if (hasErrors(errors)) {
      requestAnimationFrame(() => (document.querySelector(`#${CSS.escape(id('form'))} [aria-invalid="true"]`) as HTMLElement | null)?.focus())
      return
    }
    setSaving(true)
    const created: StubMapping[] = []
    const scenarioName = name.trim()
    try {
      for (const create of toCreates(draft)) {
        try {
          created.push(create.kind === 'catalog' ? await createCatalog.mutateAsync(create.args) : await createFree.mutateAsync(create.stub))
        } catch (error) {
          // All or nothing: take back the steps already made, newest first.
          const left: StubMapping[] = []
          for (const stub of [...created].reverse()) {
            try {
              await deleteMock.mutateAsync({ id: stub.id, version: stub.metadata?.wiremockUi?.version ?? 0 })
            } catch {
              left.push(stub)
            }
          }
          const names = left.map((stub) => stub.name ?? stub.id).join(', ')
          const vars = { n: create.step, state: create.state, message: messageOf(error, t('error.generic')).replace(/\.$/, ''), names }
          setFailure(t(left.length > 0 ? 'builder.rollbackFailed' : 'builder.failed', vars))
          // Mocks left behind belong to a scenario now: the Scenarios page must show them.
          if (left.length > 0) await queryClient.invalidateQueries({ queryKey: queryKeys.scenarios })
          return
        }
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.scenarios })
      toast.success(t(created.length === 1 ? 'builder.createdOne' : 'builder.created', { name: scenarioName, count: created.length }))
      leaving.current = true
      await navigate({ to: '/scenarios', search: { scenario: scenarioName } })
    } finally {
      setSaving(false)
    }
  }

  const preview = previewScenario(draft, (n) => t('builder.step', { n }))
  const bodyLanguage = kind === 'free' ? 'json' : endpoint?.contentType === 'json' || endpoint?.contentType === 'xml' ? endpoint.contentType : null

  return (
    <EditorShell
      title={t('builder.title')}
      caption={t('builder.caption')}
      back={
        <Link to="/scenarios" className={backLinkClass}>
          <ArrowLeftIcon aria-hidden className="size-3.5" />
          {t('builder.back')}
        </Link>
      }
      notice={<Explainer />}
      aside={
        <section aria-labelledby={id('diagram')} className="glow-border flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
          <Eyebrow id={id('diagram')}>{t('builder.diagram')}</Eyebrow>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('builder.diagramHint')}</p>
          <StateMachine scenario={{ ...preview, name: preview.name || t('builder.title') }} />
        </section>
      }
    >
      <form id={id('form')} noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        {failure && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{t('builder.failedTitle')}</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}

        <Section title={t('builder.section.scenario')}>
          <Field data-invalid={Boolean(shown.name)}>
            <FieldLabel htmlFor={id('name')}>{t('builder.name')}</FieldLabel>
            <Input
              id={id('name')}
              dir="ltr"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="order-status"
              value={name}
              aria-invalid={Boolean(shown.name)}
              aria-describedby={[id('name-hint'), shown.name && id('name-error'), existing && id('name-exists')].filter(Boolean).join(' ')}
              onChange={(e) => change(setName)(e.target.value)}
            />
            <FieldDescription id={id('name-hint')} className="text-xs">
              {t('builder.nameHint')}
            </FieldDescription>
            {existing && (
              <p id={id('name-exists')} className="flex flex-wrap items-start gap-1.5 text-xs text-hazard-fg">
                <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>{t('builder.exists', { name: existing.name })}</span>
                <Link
                  to="/scenarios"
                  search={{ scenario: existing.name }}
                  className="inline-flex items-center gap-1 text-signal-fg hover:underline"
                >
                  {t('builder.openIt')}
                  <ArrowUpRightIcon aria-hidden className="size-3" />
                </Link>
              </p>
            )}
            {shown.name && <FieldError id={id('name-error')}>{msg(shown.name)}</FieldError>}
          </Field>
        </Section>

        <Section title={t('builder.section.request')} hint={t('builder.requestHint')}>
          <FieldSet className="gap-2">
            <FieldLegend variant="label" id={id('kind-label')}>
              {t('builder.requestKind')}
            </FieldLegend>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={1}
              aria-labelledby={id('kind-label')}
              value={kind}
              onValueChange={(v) => v && change(setKind)(v as 'catalog' | 'free')}
              className="flex-wrap"
            >
              <ToggleGroupItem value="catalog" className={ON}>
                {t('builder.kind.catalog')}
              </ToggleGroupItem>
              <ToggleGroupItem value="free" className={ON}>
                {t('builder.kind.free')}
              </ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>

          {kind === 'catalog' ? (
            !picked ? (
              <div className="flex flex-col gap-2">
                <EndpointPicker onPick={(i, e) => change(setPicked)({ integration: i, endpoint: e })} />
                {shown.request && (
                  <p role="alert" className="text-xs text-mismatch">
                    {msg(shown.request)}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                  {endpoint && integration ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <MethodBadge method={endpoint.method} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{t('editor.endpointRef', { integration: integration.name, endpoint: endpoint.name })}</span>
                        <span dir="ltr" className="truncate font-mono text-[11px] text-muted-foreground">
                          {(integration.prefix === '/' ? '' : integration.prefix) + endpoint.path}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <Spinner />
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => change(setPicked)(null)}>
                    <ArrowLeftRightIcon data-icon="inline-start" />
                    {t('builder.changeEndpoint')}
                  </Button>
                </div>
                {endpoint && (
                  <>
                    <Field orientation="horizontal">
                      <Switch
                        id={id('default')}
                        checked={key.isDefault || !endpoint.lookup}
                        disabled={!endpoint.lookup}
                        onCheckedChange={(isDefault) => change(setKey)({ ...key, isDefault })}
                      />
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel htmlFor={id('default')}>{t('editor.default')}</FieldLabel>
                        <FieldDescription className="text-xs">{endpoint.lookup ? t('editor.defaultHint') : t('editor.noLookup')}</FieldDescription>
                      </div>
                    </Field>
                    {!key.isDefault && endpoint.lookup && (
                      <Field data-invalid={Boolean(shown.request)}>
                        <FieldLabel htmlFor={id('key')}>{keyLabel(t, endpoint)}</FieldLabel>
                        <Input
                          id={id('key')}
                          dir="ltr"
                          className="font-mono"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={t('editor.keyPlaceholder')}
                          value={key.keyValue}
                          aria-invalid={Boolean(shown.request)}
                          aria-describedby={shown.request ? id('request-error') : undefined}
                          onChange={(e) => change(setKey)({ ...key, keyValue: e.target.value })}
                        />
                        {shown.request && <FieldError id={id('request-error')}>{msg(shown.request)}</FieldError>}
                      </Field>
                    )}
                  </>
                )}
              </div>
            )
          ) : (
            <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <Field>
                <FieldLabel htmlFor={id('method')}>{t('builder.method')}</FieldLabel>
                <Select value={free.method} onValueChange={(method) => change(setFree)({ ...free, method })}>
                  <SelectTrigger id={id('method')} className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m} className="font-mono">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={Boolean(shown.request)}>
                <FieldLabel htmlFor={id('url')}>{t('builder.url')}</FieldLabel>
                <Input
                  id={id('url')}
                  dir="ltr"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="/orders/42/status"
                  value={free.url}
                  aria-invalid={Boolean(shown.request)}
                  aria-describedby={[id('url-hint'), shown.request && id('request-error')].filter(Boolean).join(' ')}
                  onChange={(e) => change(setFree)({ ...free, url: e.target.value })}
                />
                <FieldDescription id={id('url-hint')} className="text-xs">
                  {t('builder.urlHint')}
                </FieldDescription>
                {shown.request && <FieldError id={id('request-error')}>{msg(shown.request)}</FieldError>}
              </Field>
            </div>
          )}
        </Section>

        <Section title={t('builder.section.steps')} hint={t('builder.stepsHint')}>
          <ol aria-label={t('builder.stepsLabel')} className="flex flex-col gap-3">
            {steps.map((step, i) => (
              <StepCard
                key={step.id}
                id={(name) => id(`${step.id}-${name}`)}
                step={step}
                index={i}
                steps={steps}
                errors={shown.steps[step.id] ?? {}}
                msg={msg}
                bodyLanguage={bodyLanguage}
                exampleShown={kind === 'catalog' && step.bodyFromExample && step.body !== ''}
                catalog={kind === 'catalog'}
                onChange={(patch) => updateStep(step.id, patch)}
                onStatus={(status) => onStatus(step, status)}
                onMove={(dir) => move(step, dir)}
                onRemove={() => remove(step, i)}
              />
            ))}
          </ol>
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={add}>
            <PlusIcon data-icon="inline-start" />
            {t('builder.add')}
          </Button>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </Section>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-canvas/85 px-1 py-3 backdrop-blur">
          {attempted && hasErrors(errors) && (
            <p role="alert" className="me-auto text-xs text-mismatch">
              {t('builder.fixErrors')}
            </p>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {saving ? t('builder.saving') : t('builder.save')}
          </Button>
        </div>
      </form>

      <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('builder.leaveBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>{t('editor.stay')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('editor.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EditorShell>
  )
}

/** One step: its state, the answer (status, headers, body, delay) and where it moves the scenario next. */
function StepCard({
  id,
  step,
  index,
  steps,
  errors,
  msg,
  bodyLanguage,
  exampleShown,
  catalog,
  onChange,
  onStatus,
  onMove,
  onRemove,
}: {
  id: (name: string) => string
  step: BuilderStep
  index: number
  steps: BuilderStep[]
  errors: Partial<Record<StepField, Message>>
  msg: (m: Message | undefined) => string | undefined
  bodyLanguage: 'json' | 'xml' | null
  exampleShown: boolean
  /** A catalog request: its mocks reopen in Simple mode unless the step adds custom headers. */
  catalog: boolean
  onChange: (patch: Partial<BuilderStep>) => void
  onStatus: (status: string) => void
  onMove: (dir: 'up' | 'down') => void
  onRemove: () => void
}) {
  const t = useT()
  const n = index + 1
  const first = index === 0
  const last = index === steps.length - 1
  const state = stepState(steps, index)
  const stateLabel = state || t('builder.step', { n })
  const described = (field: StepField, ...extra: (string | false)[]) =>
    [...extra, errors[field] && id(`${field}-error`)].filter(Boolean).join(' ') || undefined
  const error = (field: StepField) => (errors[field] ? <FieldError id={id(`${field}-error`)}>{msg(errors[field])}</FieldError> : null)

  const nextState = !last ? stepState(steps, index + 1) || t('builder.step', { n: n + 1 }) : ''
  const target = targetOf(steps, index)

  return (
    <li
      aria-labelledby={id('title')}
      className="flex flex-col gap-4 rounded-md border border-line bg-surface-2/50 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id('title')} tabIndex={-1} className="flex items-center gap-2 outline-none">
          <span className="font-mono text-[10px] text-signal-fg">{String(n).padStart(2, '0')}</span>
          <span className="font-display text-lg leading-none font-semibold tracking-wide uppercase">{t('builder.step', { n })}</span>
          <span dir="ltr" className="font-mono text-xs text-muted-foreground">
            {stateLabel}
            {target ? ` → ${target}` : ''}
          </span>
        </h3>
        <div className="flex items-center gap-1">
          <Button
            id={id('up')}
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={first}
            aria-label={t('builder.moveUp', { n })}
            onClick={() => onMove('up')}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            id={id('down')}
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={last}
            aria-label={t('builder.moveDown', { n })}
            onClick={() => onMove('down')}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={steps.length === 1}
            aria-label={t('builder.remove', { n })}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.state)}>
          <FieldLabel htmlFor={id('state')}>{t('builder.state')}</FieldLabel>
          <Input
            id={id('state')}
            dir="ltr"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('builder.stateOf', { n })}
            placeholder={first ? STARTED : 'approved'}
            value={first ? STARTED : step.state}
            readOnly={first}
            aria-invalid={Boolean(errors.state)}
            aria-describedby={described('state', id('state-hint'))}
            onChange={(e) => onChange({ state: e.target.value })}
          />
          <FieldDescription id={id('state-hint')} className="text-xs">
            {first ? t('builder.stateFirstHint') : t('builder.stateHint')}
          </FieldDescription>
          {error('state')}
        </Field>
        <Field>
          <FieldLabel htmlFor={id('move')}>{t('builder.moveTo')}</FieldLabel>
          <Select value={last && step.moveTo === 'stay' ? 'next' : step.moveTo} onValueChange={(moveTo) => onChange({ moveTo: moveTo as MoveTo })}>
            <SelectTrigger id={id('move')} aria-label={t('builder.moveToOf', { n })} className="w-full font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next">{last ? t('builder.moveNextLast') : t('builder.moveNext', { state: nextState })}</SelectItem>
              {/* On the last step the default already stays. */}
              {!last && <SelectItem value="stay">{t('builder.moveStay', { state: stateLabel })}</SelectItem>}
              {steps.map((other, j) =>
                j === index ? null : (
                  <SelectItem key={other.id} value={`step:${other.id}`}>
                    {t('builder.moveStep', { n: j + 1, state: stepState(steps, j) || t('builder.step', { n: j + 1 }) })}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.status)}>
          <FieldLabel htmlFor={id('status')}>{t('builder.status')}</FieldLabel>
          <Input
            id={id('status')}
            type="number"
            inputMode="numeric"
            min={100}
            max={599}
            className="font-mono"
            aria-label={t('builder.statusOf', { n })}
            value={step.status}
            aria-invalid={Boolean(errors.status)}
            aria-describedby={described('status')}
            onChange={(e) => onStatus(e.target.value)}
          />
          {error('status')}
        </Field>
        <Field data-invalid={Boolean(errors.delay)}>
          <FieldLabel htmlFor={id('delay')}>
            {t('builder.delay')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
          </FieldLabel>
          <Input
            id={id('delay')}
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            className="font-mono"
            aria-label={t('builder.delayOf', { n })}
            placeholder="3"
            value={step.delaySeconds}
            aria-invalid={Boolean(errors.delay)}
            aria-describedby={described('delay')}
            onChange={(e) => onChange({ delaySeconds: e.target.value })}
          />
          {error('delay')}
        </Field>
      </div>

      <Field data-invalid={Boolean(errors.headers)}>
        <span className="text-sm font-medium">{t('builder.headers')}</span>
        <HeaderRows
          label={t('builder.headersOf', { n })}
          rows={step.headers}
          invalid={Boolean(errors.headers)}
          describedBy={described('headers', catalog && id('headers-hint'))}
          onChange={(headers) => onChange({ headers })}
        />
        {catalog && (
          <FieldDescription id={id('headers-hint')} className="text-xs">
            {t('builder.headersAdvanced')}
          </FieldDescription>
        )}
        {error('headers')}
      </Field>

      <Field data-invalid={Boolean(errors.body)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {bodyLanguage ? (
            <span className="text-sm font-medium">{t('builder.body')}</span>
          ) : (
            <FieldLabel htmlFor={id('body')}>{t('builder.body')}</FieldLabel>
          )}
          {exampleShown && <span className="text-[11px] text-muted-foreground">{t('editor.bodyFromExample', { status: step.status })}</span>}
        </div>
        {bodyLanguage ? (
          <CodeEditor
            value={step.body}
            language={bodyLanguage}
            label={t('builder.bodyOf', { n })}
            invalid={Boolean(errors.body)}
            describedBy={described('body')}
            minHeight="6rem"
            maxHeight="20rem"
            onChange={(body) => onChange({ body, bodyFromExample: false })}
          />
        ) : (
          <Textarea
            id={id('body')}
            dir="ltr"
            aria-label={t('builder.bodyOf', { n })}
            className="min-h-24 font-mono text-xs md:text-xs"
            spellCheck={false}
            value={step.body}
            aria-invalid={Boolean(errors.body)}
            aria-describedby={described('body')}
            onChange={(e) => onChange({ body: e.target.value, bodyFromExample: false })}
          />
        )}
        {error('body')}
      </Field>
    </li>
  )
}

/** The plain-words "what is a scenario" strip, with the order-status example as two calls. */
function Explainer() {
  const t = useT()
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="glass-panel flex flex-col gap-3 rounded-md border border-line p-4 sm:p-5 md:flex-row md:items-center md:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 id={titleId} className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          <span aria-hidden="true">— </span>
          {t('builder.explainTitle')}
        </h2>
        <p className="text-sm leading-relaxed">{t('builder.explain')}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('builder.explainMore')}</p>
      </div>
      <ol aria-hidden className="flex shrink-0 flex-col gap-1.5 font-mono text-[11px]">
        <li className="flex items-center gap-2 rounded-sm border border-line/70 bg-surface-2 px-2 py-1.5">
          <span className="text-muted-foreground">#1</span>
          <span className="text-signal-fg">{STARTED}</span>
          <span>→ pending</span>
          <span className="text-muted-foreground">⇢ approved</span>
        </li>
        <li className="flex items-center gap-2 rounded-sm border border-line/70 bg-surface-2 px-2 py-1.5">
          <span className="text-muted-foreground">#2</span>
          <span className="text-signal-fg">approved</span>
          <span>→ approved</span>
        </li>
      </ol>
    </section>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glow-border flex flex-col gap-4 rounded-md border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <Eyebrow>{title}</Eyebrow>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}
