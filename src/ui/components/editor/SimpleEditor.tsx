import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ChevronDownIcon, ChevronRightIcon, EyeIcon, FlaskConicalIcon, ListPlusIcon, PlusIcon, SaveIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { GroupBy } from '@/server/mocks/groups'
import type { KeyLocation } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { type PreviewArgs, useCreateMock, usePreviewMock, usePreviewMockGroup, useSaveMockGroup, useScenarios, useUpdateMock } from '@/ui/api/queries'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet'
import { Spinner } from '@/ui/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import type { MessageKey } from '@/ui/i18n'
import { type QuickRequest, type ScenarioForm, type ScenarioSeed, type SimpleForm, emptyQuickForm, quickMockName, toQuickInput } from '@/ui/lib/editor-sync'
import {
  type ResponseRow,
  type Responses,
  MAX_CONDITIONS,
  addFirstRow,
  conditionLabel,
  groupInputFrom,
  newRow,
  noResponses,
  responseSummary,
  responsesProblems,
  rowLabel,
  suggestBy,
} from '@/ui/lib/groups'
import { templateVariables } from '@/server/mocks/groups'
import { cn } from '@/ui/lib/utils'
import { CodeEditor } from './CodeEditor'
import { QuickRequestFields, quickRequestErrors } from './QuickRequestFields'
import { type Errors, type FieldName, ON, ResponseFields, Section, responseBlocked, responseClientErrors } from './ResponseFields'
import { ScenarioSection } from './ScenarioSection'

const SERVER_FIELD = new Map<string, FieldName>([
  ['keyValue', 'keyValue'],
  ['request.url', 'url'],
  ['request.urlType', 'url'],
  ['request.query', 'query'],
  ['priority', 'priority'],
  ['headers', 'headers'],
  ['isDefault', 'keyValue'],
  ['status', 'status'],
  ['body', 'body'],
  ['delayMs', 'delay'],
  ['fault', 'fault'],
  ['name', 'name'],
  ['proxy.baseUrl', 'proxyBaseUrl'],
  ['proxy.stripPrefix', 'proxyStripPrefix'],
  ['proxy.addHeaders', 'proxyHeaders'],
  ['proxy.removeHeaders', 'proxyHeaders'],
  ['webhook.method', 'webhookMethod'],
  ['webhook.url', 'webhookUrl'],
  ['webhook.headers', 'webhookHeaders'],
  ['webhook.body', 'webhookBody'],
  ['webhook.delay', 'webhookDelay'],
  ['scenario.name', 'scenarioName'],
  ['scenario.requiredState', 'scenarioRequiredState'],
  ['scenario.newState', 'scenarioNewState'],
])

/**
 * A server message for a field, without the API's field path ("webhook.delay.lower must be …" → "This value must
 * be …"): the field it belongs to is already marked, and the reader never sees those names.
 */
export function withoutFieldPath(message: string, t: ReturnType<typeof useT>): string {
  const rest = /^[\w.[\]]+\s+(.*)$/s.exec(message)?.[1]
  return rest ? t('editor.fieldProblem', { problem: rest.replace(/\.$/, '') }) : message
}

/** The form field a server validation message names, if any (the longest known dotted prefix). */
function fieldOf(message: string): FieldName | undefined {
  if (message === 'body must be an object') return undefined // about the request, not the response body
  const parts = (/^([\w.]+)/.exec(message)?.[1] ?? '').split('.')
  for (let n = parts.length; n > 0; n--) {
    const field = SERVER_FIELD.get(parts.slice(0, n).join('.'))
    if (field) return field
  }
  return undefined
}

const LOCATIONS: [KeyLocation, MessageKey][] = [
  ['path', 'responses.location.path'],
  ['query', 'responses.location.query'],
  ['header', 'responses.location.header'],
  ['jsonPath', 'responses.location.jsonPath'],
  ['xPath', 'responses.location.xPath'],
  ['form', 'responses.location.form'],
]
const PROBLEM: Record<string, MessageKey> = {
  byRequired: 'responses.problem.byRequired',
  byPathMissing: 'responses.problem.byPathMissing',
  byTwice: 'responses.problem.byTwice',
  valueRequired: 'responses.problem.valueRequired',
  valueTwice: 'responses.problem.valueTwice',
}

/** A saved mock with several responses: its stubs (for their versions, and to test one response). */
export type SavedGroup = { id: string; stubs: StubMapping[] }

/**
 * The Simple editor: the mock's request, its response, and (on demand) more responses for some requests. With no
 * extra responses it is one stub, built by the server's quick builder and saved as a free-form mock (`PUT { stub,
 * version }` over `mock`). With extra responses, "Choose the response by" names the conditions, each response says
 * which values it is for, and the mock's own response answers every other request; it is saved as a group
 * (src/server/mocks/groups.ts). `onChange` / `onResponsesChange` report every change; `onSaved` / `onGroupSaved` take
 * over after a save (default: open the mock); `onConflict` takes over a 409.
 */
export function SimpleEditor({
  initial,
  initialResponses,
  mock,
  group,
  scenarioSeed,
  tags = [],
  onChange,
  onResponsesChange,
  onSaved,
  onGroupSaved,
  onConflict,
  onTest,
}: {
  initial?: SimpleForm
  initialResponses?: Responses
  mock?: StubMapping
  /** The saved group this editor opened (its responses are in `initialResponses`). */
  group?: SavedGroup
  /** A new mock's scenario (when `initial` is not given): the Scenario section starts on and filled in. */
  scenarioSeed?: ScenarioSeed
  /** The mock's tags (edited above the tabs); saved with the stub. */
  tags?: string[]
  onChange?: (form: SimpleForm) => void
  onResponsesChange?: (responses: Responses) => void
  onSaved?: (stub: StubMapping) => void | Promise<void>
  onGroupSaved?: (stubs: StubMapping[]) => void | Promise<void>
  onConflict?: () => void
  /** Test one saved response (opens the test panel filled for its values). */
  onTest?: (stub: StubMapping) => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`

  const [form, setForm] = useState<SimpleForm>(() => initial ?? emptyQuickForm(scenarioSeed))
  const [responses, setResponses] = useState<Responses>(() => initialResponses ?? noResponses())
  const quick = form.quick!
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<{ title: string; message: string } | null>(null)
  const [preview, setPreview] = useState<unknown>(null)
  // Required URLs are only flagged once the user tries to preview or save.
  const [attempted, setAttempted] = useState(false)
  // Which response cards are open (the new ones open; "every other request" is `main`).
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const scenarios = useScenarios({ enabled: form.scenario.enabled, live: true })
  const previewMock = usePreviewMock()
  const previewGroup = usePreviewMockGroup()
  const createFreeMock = useCreateMock()
  const updateMock = useUpdateMock()
  const saveGroup = useSaveMockGroup()
  const [saving, setSaving] = useState(false)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => onChangeRef.current?.(form), [form])
  const onResponsesRef = useRef(onResponsesChange)
  onResponsesRef.current = onResponsesChange
  useEffect(() => onResponsesRef.current?.(responses), [responses])

  const several = responses.rows.length > 0
  // Saved through the group path: it has (or had) several responses.
  const asGroup = several || group !== undefined
  const problems = responsesProblems(quick, responses)
  const quickErrors = quickRequestErrors(t, quick, attempted)
  const mainErrors = !several || responses.fallbackOn ? responseClientErrors(t, form, attempted) : {}
  const clientErrors: Errors = { ...mainErrors, ...quickErrors }
  if (!asGroup && form.scenario.enabled && attempted && form.scenario.name.trim() === '') clientErrors.scenarioName = t('editor.scenario.nameRequired')
  const errors: Errors = { ...serverErrors, ...clientErrors }
  const rowsBlocked = responses.rows.some((r) => Object.keys(responseClientErrors(t, r.form, attempted)).length > 0)
  const blocked = Object.keys(clientErrors).length > 0 || rowsBlocked || (several && attempted && Object.keys(problems).length > 0)

  const clear = (clears: FieldName[]) => {
    if (clears.some((c) => serverErrors[c])) setServerErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clears.includes(k as FieldName))))
  }
  const update = (patch: Partial<SimpleForm>, clears: FieldName[] = []) => {
    setForm((f) => ({ ...f, ...patch }))
    clear(clears)
  }
  const updateQuick = (patch: Partial<QuickRequest>, clears: FieldName[]) => {
    setForm((f) => ({ ...f, quick: { ...f.quick!, ...patch } }))
    clear(clears)
  }
  const updateScenario = (patch: Partial<ScenarioForm>) => {
    setForm((f) => ({ ...f, scenario: { ...f.scenario, ...patch } }))
    clear(['scenarioName', 'scenarioRequiredState', 'scenarioNewState'])
  }
  const patchRow = (key: string, patch: Partial<ResponseRow>) => setResponses((r) => ({ ...r, rows: r.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)) }))
  const setBy = (by: GroupBy[]) => setResponses((r) => ({ ...r, by }))

  const addResponse = () => {
    const next = several ? { ...responses, rows: [...responses.rows, newRow(responses.rows.at(-1)!.form, responses.by)] } : addFirstRow(form, responses)
    setResponses(next)
    setOpen((o) => new Set(o).add(next.rows.at(-1)!.key))
  }
  const addCondition = () =>
    setResponses((r) => ({ ...r, by: [...r.by, suggestBy(quick, r.by)], rows: r.rows.map((row) => ({ ...row, values: [...row.values, ''] })) }))
  const removeCondition = (i: number) =>
    setResponses((r) => ({ ...r, by: r.by.filter((_, j) => j !== i), rows: r.rows.map((row) => ({ ...row, values: row.values.filter((_, j) => j !== i) })) }))
  const removeRow = (key: string) =>
    setResponses((r) => {
      const rows = r.rows.filter((row) => row.key !== key)
      // The last extra response gone: the mock answers every request again.
      return rows.length === 0 ? { ...r, rows, fallbackOn: true } : { ...r, rows }
    })
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const handleError = (error: unknown, title: string) => {
    if (error instanceof ApiError && error.status === 409) {
      if (onConflict) return onConflict()
      setFormError({ title: t('editor.saveFailed'), message: t('editor.conflict') })
      return
    }
    const message = error instanceof Error && error.message ? error.message : t('error.generic')
    const field = !asGroup && error instanceof ApiError && error.status === 400 ? fieldOf(error.field ?? message) : undefined
    if (field) setServerErrors({ [field]: field === 'keyValue' && /required/.test(message) ? t('editor.keyRequired') : withoutFieldPath(message, t) })
    else setFormError({ title, message })
  }
  const withTagList = <T extends object>(input: T): T => (tags.length > 0 ? { ...input, tags } : input)
  const args = (): PreviewArgs => ({ quick: withTagList(toQuickInput(form)) })
  const groupInput = () => groupInputFrom(form, tags, responses)
  const reset = () => {
    setServerErrors({})
    setFormError(null)
  }

  /** Flags the required URLs; false when the form has something to fix first. */
  const ready = () => {
    setAttempted(true)
    if (Object.keys(quickRequestErrors(t, quick, true)).length > 0) return false
    if (several) {
      if (Object.keys(problems).length > 0) {
        // Show what is wrong: open the responses whose values need fixing.
        setOpen((o) => new Set([...o, ...responses.rows.filter((r) => problems[r.key]).map((r) => r.key)]))
        return false
      }
      const bad = responses.rows.filter((r) => responseBlocked(t, r.form))
      if (bad.length > 0) {
        setOpen((o) => new Set([...o, ...bad.map((r) => r.key)]))
        return false
      }
      if (responses.fallbackOn && responseBlocked(t, form)) {
        setOpen((o) => new Set(o).add('main'))
        return false
      }
      return true
    }
    return !(blocked || responseBlocked(t, form) || (!asGroup && form.scenario.enabled && form.scenario.name.trim() === ''))
  }

  const onPreview = async () => {
    if (!ready()) return
    reset()
    try {
      setPreview(asGroup ? await previewGroup.mutateAsync({ input: groupInput(), id: group?.id }) : await previewMock.mutateAsync(args()))
    } catch (error) {
      handleError(error, t('editor.previewFailed'))
    }
  }

  const onSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || !ready()) return
    reset()
    setSaving(true)
    try {
      if (asGroup) {
        const input = groupInput()
        const stubs = group
          ? await saveGroup.mutateAsync({ id: group.id, input, versions: Object.fromEntries(group.stubs.map((s) => [s.id, s.metadata?.wiremockUi?.version ?? 0])) })
          : await saveGroup.mutateAsync({ input, ...(mock ? { replaces: { id: mock.id, version: mock.metadata?.wiremockUi?.version ?? 0 } } : {}) })
        toast.success(t('editor.saved'))
        if (onGroupSaved) await onGroupSaved(stubs)
        else await navigate({ to: '/mocks/$id', params: { id: stubs[0]!.id } })
        return
      }
      let saved: StubMapping
      if (mock) {
        // The server's builder stays the single source of the stub; the PUT carries the version we opened.
        const stub = await previewMock.mutateAsync(args())
        saved = await updateMock.mutateAsync({ id: mock.id, stub, version: mock.metadata?.wiremockUi?.version ?? 0 })
      } else {
        // The quick builder makes the stub, the normal create checks and saves it.
        saved = await createFreeMock.mutateAsync(await previewMock.mutateAsync(args()))
      }
      toast.success(t('editor.saved'))
      if (onSaved) await onSaved(saved)
      else await navigate({ to: '/mocks/$id', params: { id: saved.id } })
    } catch (error) {
      handleError(error, t('editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: FieldName) => (errors[field] ? <FieldError id={id(`${field}-error`)}>{errors[field]}</FieldError> : null)
  const stubOf = (stubId: string | undefined) => (stubId ? group?.stubs.find((s) => s.id === stubId) : undefined)
  const savedMain = several ? stubOf(responses.fallbackStubId) : undefined
  const pending = previewMock.isPending || previewGroup.isPending

  const mainFields = (
    <ResponseFields form={form} request={quick} serverErrors={serverErrors} attempted={attempted} onChange={update} compact />
  )

  // Under the last response: a scenario step keeps one response, any other mock can add one.
  const addButton =
    form.scenario.enabled && !several ? (
      <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-xs text-muted-foreground">{t('responses.addScenario')}</p>
    ) : (
      <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-line px-3 py-3 text-center">
        <Button type="button" variant="outline" onClick={addResponse}>
          <ListPlusIcon data-icon="inline-start" />
          {t('responses.add')}
        </Button>
        <span className="text-xs text-muted-foreground">{several ? t('responses.addMoreHint') : t('responses.addHint')}</span>
      </div>
    )

  return (
    <form noValidate onSubmit={onSave} className="flex flex-col gap-4">
      {formError && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{formError.title}</AlertTitle>
          <AlertDescription>{formError.message}</AlertDescription>
        </Alert>
      )}

      <Section title={t('editor.section.match')}>
        <QuickRequestFields quick={quick} errors={{ url: errors.url, query: errors.query, priority: errors.priority }} onChange={updateQuick} />
        {several && (
          <Conditions
            quick={quick}
            by={responses.by}
            problems={attempted ? problems : {}}
            onChange={setBy}
            onAdd={addCondition}
            onRemove={removeCondition}
          />
        )}
      </Section>

      {!several ? (
        // One box for the whole response (what it answers, its behaviour, its call back), like a response card.
        <section aria-label={t('editor.section.respond')} className="glow-border flex flex-col gap-4 rounded-md border border-line bg-surface p-4 sm:p-5">
          {mainFields}
          {addButton}
        </section>
      ) : (
        <Section title={t('responses.title', { count: responses.rows.length + (responses.fallbackOn ? 1 : 0) })}>
          <ul aria-label={t('responses.listLabel')} className="flex flex-col gap-2">
            {responses.rows.map((row) => (
              <ResponseCard
                key={row.key}
                row={row}
                by={responses.by}
                request={quick}
                open={open.has(row.key)}
                problem={attempted && problems[row.key] ? t(PROBLEM[problems[row.key]!]!) : undefined}
                attempted={attempted}
                saved={stubOf(row.stubId)}
                onToggle={() => toggle(row.key)}
                onChange={(patch) => patchRow(row.key, patch)}
                onRemove={() => removeRow(row.key)}
                onTest={onTest}
              />
            ))}
            <li className="rounded-md border border-line bg-surface-2/40">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <button
                  type="button"
                  aria-expanded={responses.fallbackOn ? open.has('main') : undefined}
                  disabled={!responses.fallbackOn}
                  onClick={() => toggle('main')}
                  className="flex items-center gap-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                >
                  {responses.fallbackOn &&
                    (open.has('main') ? <ChevronDownIcon aria-hidden className="size-4" /> : <ChevronRightIcon aria-hidden className="size-4" />)}
                  {t('responses.everyOther')}
                </button>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={1}
                  aria-label={t('responses.everyOther')}
                  value={responses.fallbackOn ? 'on' : 'off'}
                  onValueChange={(v) => v && setResponses((r) => ({ ...r, fallbackOn: v === 'on' }))}
                >
                  <ToggleGroupItem value="on" className={ON}>
                    {t('responses.everyOtherOn')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="off" className={ON}>
                    {t('responses.everyOtherOff')}
                  </ToggleGroupItem>
                </ToggleGroup>
                {responses.fallbackOn && <Summary form={form} />}
                <span className="flex-1" />
                {responses.fallbackOn && onTest && <TestButton saved={savedMain} label={t('responses.everyOther')} onTest={onTest} />}
              </div>
              <p className="px-3 pb-2.5 text-xs text-muted-foreground">
                {responses.fallbackOn ? t('responses.everyOtherHint') : t('responses.everyOtherOffHint')}
              </p>
              {responses.fallbackOn && open.has('main') && <div className="flex flex-col gap-4 border-t border-line p-4">{mainFields}</div>}
            </li>
          </ul>
          {addButton}
        </Section>
      )}

      {!asGroup && (
        <Section title={t('editor.section.scenario')}>
          <ScenarioSection
            scenario={form.scenario}
            existing={scenarios.data ?? []}
            selfId={mock?.id}
            errors={{ name: errors.scenarioName, requiredState: errors.scenarioRequiredState, newState: errors.scenarioNewState }}
            onChange={updateScenario}
          />
        </Section>
      )}

      <Section title={t('editor.section.label')}>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor={id('name')}>
            {t('editor.name')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
          </FieldLabel>
          <Input
            id={id('name')}
            value={form.name}
            placeholder={quickMockName(quick)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? id('name-error') : undefined}
            onChange={(e) => update({ name: e.target.value }, ['name'])}
          />
          {fieldError('name')}
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/85 px-1 py-3 backdrop-blur">
        <Button type="button" variant="outline" disabled={pending || saving || blocked} onClick={() => void onPreview()}>
          {pending && !saving ? <Spinner data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
          {t('editor.preview')}
        </Button>
        <Button type="submit" disabled={saving || blocked}>
          {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {saving ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>

      <Sheet open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <SheetContent className="glass-panel flex w-full flex-col gap-0 sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('editor.previewTitle')}</SheetTitle>
            <SheetDescription className="text-xs">{asGroup ? t('responses.previewDescription') : t('editor.previewDescription')}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            {preview !== null && <CodeEditor value={JSON.stringify(preview, null, 2)} language="json" label={t('editor.previewTitle')} readOnly />}
          </div>
        </SheetContent>
      </Sheet>
    </form>
  )
}

/** "Choose the response by": the conditions, each a place in the request (and its name). */
function Conditions({
  quick,
  by,
  problems,
  onChange,
  onAdd,
  onRemove,
}: {
  quick: QuickRequest
  by: GroupBy[]
  problems: Record<string, string>
  onChange: (by: GroupBy[]) => void
  onAdd: () => void
  onRemove: (i: number) => void
}) {
  const t = useT()
  const ids = useId()
  const vars = quick.urlType === 'template' ? templateVariables(quick.url) : []
  const set = (i: number, patch: Partial<GroupBy>) => onChange(by.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-signal/40 bg-signal/5 p-3">
      <legend className="px-1 text-sm font-medium">{t('responses.chooseBy')}</legend>
      <p className="text-xs text-muted-foreground">{t('responses.chooseByHint')}</p>
      {by.map((b, i) => {
        const problem = problems[`by:${i}`]
        const nameId = `${ids}-name-${i}`
        const errorId = `${ids}-error-${i}`
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={b.location}
                onValueChange={(v) => {
                  const location = v as KeyLocation
                  set(i, { location, expression: location === 'path' ? (vars.at(-1) ?? '') : location === 'jsonPath' ? '$.' : '' })
                }}
              >
                <SelectTrigger className="w-48" aria-label={t('responses.conditionWhere', { n: i + 1 })}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map(([location, key]) => (
                    <SelectItem key={location} value={location}>
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {b.location === 'path' && vars.length > 0 ? (
                <Select value={vars.includes(b.expression) ? b.expression : ''} onValueChange={(v) => set(i, { expression: v })}>
                  <SelectTrigger className="w-48 font-mono" aria-label={t('responses.conditionName', { n: i + 1 })} aria-invalid={Boolean(problem)} aria-describedby={problem ? errorId : undefined}>
                    <SelectValue placeholder={t('responses.pickVariable')} />
                  </SelectTrigger>
                  <SelectContent>
                    {vars.map((v) => (
                      <SelectItem key={v} value={v} className="font-mono">
                        {`{${v}}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={nameId}
                  dir="ltr"
                  className="w-56 font-mono"
                  aria-label={t('responses.conditionName', { n: i + 1 })}
                  placeholder={t(b.location === 'jsonPath' ? 'responses.placeholder.jsonPath' : b.location === 'xPath' ? 'responses.placeholder.xPath' : b.location === 'header' ? 'responses.placeholder.header' : 'responses.placeholder.name')}
                  value={b.expression}
                  aria-invalid={Boolean(problem)}
                  aria-describedby={problem ? errorId : undefined}
                  onChange={(e) => set(i, { expression: e.target.value })}
                />
              )}
              {by.length > 1 && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('responses.removeCondition', { name: b.expression || String(i + 1) })} onClick={() => onRemove(i)}>
                  <XIcon />
                </Button>
              )}
            </div>
            {problem && (
              <p id={errorId} className="text-xs text-mismatch">
                {t(PROBLEM[problem]!)}
              </p>
            )}
          </div>
        )
      })}
      {by.length < MAX_CONDITIONS && (
        <Button type="button" variant="link" size="sm" className="h-auto self-start p-0 text-signal-fg" onClick={onAdd}>
          <PlusIcon data-icon="inline-start" />
          {t('responses.addCondition')}
        </Button>
      )}
    </fieldset>
  )
}

/** One extra response: its values, a summary, Test, remove; open, its whole response. */
function ResponseCard({
  row,
  by,
  request,
  open,
  problem,
  attempted,
  saved,
  onToggle,
  onChange,
  onRemove,
  onTest,
}: {
  row: ResponseRow
  by: GroupBy[]
  request: QuickRequest
  open: boolean
  problem?: string
  attempted: boolean
  saved?: StubMapping
  onToggle: () => void
  onChange: (patch: Partial<ResponseRow>) => void
  onRemove: () => void
  onTest?: (stub: StubMapping) => void
}) {
  const t = useT()
  const ids = useId()
  const label = rowLabel(by, row.values) || t('responses.newResponse')
  const hasErrors = attempted && Object.keys(responseClientErrors(t, row.form, true)).length > 0
  return (
    <li className={cn('rounded-md border bg-surface-2/40', problem || hasErrors ? 'border-mismatch/60' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${ids}-body`}
          aria-label={t('responses.toggle', { values: label })}
          onClick={onToggle}
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <ChevronDownIcon aria-hidden className="size-4" /> : <ChevronRightIcon aria-hidden className="size-4" />}
        </button>
        <span className="text-sm">{t('responses.when')}</span>
        {by.map((b, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-sm text-muted-foreground">{t('responses.and')}</span>}
            <label htmlFor={`${ids}-v${i}`} className="font-mono text-xs">
              {conditionLabel(b) || '…'} =
            </label>
            <Input
              id={`${ids}-v${i}`}
              dir="ltr"
              className="h-8 w-32 font-mono text-xs"
              placeholder={t('responses.any')}
              value={row.values[i] ?? ''}
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? `${ids}-problem` : undefined}
              onChange={(e) => onChange({ values: row.values.map((v, j) => (j === i ? e.target.value : v)) })}
            />
          </span>
        ))}
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <Summary form={row.form} />
        <span className="flex-1" />
        {onTest && <TestButton saved={saved} label={label} onTest={onTest} />}
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('responses.remove', { values: label })} onClick={onRemove}>
          <XIcon />
        </Button>
      </div>
      {problem && (
        <p id={`${ids}-problem`} className="px-3 pb-2 text-xs text-mismatch">
          {problem}
        </p>
      )}
      {open && (
        <div id={`${ids}-body`} className="flex flex-col gap-4 border-t border-line p-4">
          <ResponseFields
            form={row.form}
            request={request}
            attempted={attempted}
            compact
            onChange={(patch) => onChange({ form: { ...row.form, ...patch } })}
          />
        </div>
      )}
    </li>
  )
}

/** A response's status and the start of its body. */
function Summary({ form }: { form: SimpleForm }) {
  const t = useT()
  const { status, text } = responseSummary(form)
  return (
    <span className="flex min-w-0 items-center gap-2">
      {status !== null ? <StatusBadge status={status} /> : <span className="text-xs text-muted-foreground">{form.answer === 'proxy' ? t('responses.forwards') : t('responses.breaks')}</span>}
      {text && (
        <span dir="ltr" className="max-w-72 truncate font-mono text-xs text-muted-foreground">
          {text}
        </span>
      )}
    </span>
  )
}

/** Test a saved response; a new one says to save first. */
function TestButton({ saved, label, onTest }: { saved?: StubMapping; label: string; onTest: (stub: StubMapping) => void }) {
  const t = useT()
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-label={t('responses.test', { values: label })}
      title={saved ? t('curl.savedHint') : t('responses.testUnsaved')}
      onClick={() => (saved ? onTest(saved) : toast.info(t('responses.testUnsaved')))}
    >
      <FlaskConicalIcon data-icon="inline-start" />
      {t('test.open')}
    </Button>
  )
}

