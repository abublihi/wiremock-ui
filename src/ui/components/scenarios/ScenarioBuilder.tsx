import { useEffect, useId, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  InfoIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError, apiFetch } from '@/ui/api/client'
import {
  queryKeys,
  restoreMock,
  useCreateMock,
  useDeleteMock,
  useMocks,
  useScenarios,
  useUpdateMock,
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
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Spinner } from '@/ui/components/ui/spinner'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import { STARTED, fromEditable, toEditable, withTags } from '@/ui/lib/editor-sync'
import { tagsOf } from '@/server/mocks/tags'
import {
  type BuilderDraft,
  type EditChange,
  type KeptMock,
  type LoadedScenario,
  type RebaseNote,
  editChanges,
  keptOnLostStates,
  rebaseScenario,
  strandedState,
  loadScenario,
  type BuilderErrors,
  type BuilderStep,
  type Message,
  type MoveTo,
  type StepField,
  answerLabel,
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
import { HeaderRows } from '@/ui/components/editor/HeaderRows'
import { ScenarioRequest } from './ScenarioRequest'
import { StateMachine } from './StateMachine'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

const URL_FIELDS = ['url', 'urlPath', 'urlPathTemplate', 'urlPattern', 'urlPathPattern'] as const
/** The method and URL a mock matches, as the request summary shows them. */
function requestOf(stub: StubMapping | undefined): { method?: string; url?: string } {
  const request = (stub?.request ?? {}) as Record<string, unknown>
  const method = typeof request.method === 'string' ? request.method : undefined
  const url = URL_FIELDS.map((f) => request[f]).find((v): v is string => typeof v === 'string')
  return { method, url }
}
/** The stub as it was saved (to put back when a save is undone). */
const asSaved = (stub: StubMapping) => withTags(fromEditable(toEditable(stub), undefined), tagsOf(stub))

/**
 * The scenario builder. Without `editName`: "New scenario" — one request and an ordered list of steps (state, answer,
 * where it moves next), saved as one mock per step. With it: "Edit scenario" — the same form over that scenario's mocks,
 * saved as the difference (create, update, delete). Either way all of it is saved, or none.
 */
export function ScenarioBuilder({ editName }: { editName?: string } = {}) {
  return editName === undefined ? <BuilderForm /> : <ScenarioEditLoader name={editName} />
}

/** Loads a scenario's mocks for the edit form; explains a scenario it can't edit as steps. */
function ScenarioEditLoader({ name }: { name: string }) {
  const t = useT()
  const mocks = useMocks({ scenario: name })
  // Loaded once: background refetches never replace the user's draft.
  const [loaded, setLoaded] = useState<LoadedScenario>()
  if (!loaded && mocks.data && !mocks.isPlaceholderData) setLoaded(loadScenario(mocks.data, name))
  const back = (
    <Link to="/scenarios" search={{ scenario: name }} className={backLinkClass}>
      <ArrowLeftIcon aria-hidden className="size-3.5" />
      {t('builder.back')}
    </Link>
  )
  const problem = mocks.isError
    ? { title: t('builder.editLoadFailed'), body: mocks.error.message }
    : loaded && loaded.steps.length === 0 && loaded.kept.length === 0
      ? { title: t('builder.editMissing', { name }), body: t('builder.editMissingBody') }
      : loaded?.startedMissing
        ? { title: t('builder.editNoStart', { name }), body: t('builder.editNoStartBody') }
        : undefined
  if (problem || !loaded) {
    return (
      <EditorShell title={t('builder.editTitle')} caption={`// ${name}`} back={back}>
        {problem ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{problem.title}</AlertTitle>
            <AlertDescription>{problem.body}</AlertDescription>
          </Alert>
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </EditorShell>
    )
  }
  return <BuilderForm edit={loaded} />
}

function BuilderForm({ edit }: { edit?: LoadedScenario }) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scenarios = useScenarios()
  const createFree = useCreateMock()
  const deleteMock = useDeleteMock()
  const updateMock = useUpdateMock()

  const counter = useRef(2)
  const nextId = () => `step-${++counter.current}`
  const [name, setName] = useState(edit?.name ?? '')
  // Editing: the scenario as last read (re-read after a refused save), and what changed in it meanwhile, per step.
  const [base, setBase] = useState(edit)
  const [notes, setNotes] = useState<Record<string, RebaseNote>>({})
  const [steps, setSteps] = useState<BuilderStep[]>(() => edit?.steps ?? [newStep('step-1'), newStep('step-2')])
  const [free, setFree] = useState({ method: 'GET', url: '' })
  const [touched, setTouched] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // The two cards a move just swapped flash once; `round` restarts the animation on every move.
  const [flash, setFlash] = useState<{ ids: string[]; round: number }>({ ids: [], round: 0 })

  const firstRequest = requestOf(edit?.steps[0]?.source)
  const draft: BuilderDraft = {
    name,
    request: edit ? { kind: 'existing', ...firstRequest } : { kind: 'free', ...free },
    steps,
  }
  const errors = validateDraft(draft, { keepName: edit?.name })
  const shown: BuilderErrors = attempted ? errors : { steps: {}, ...(errors.name?.key === 'builder.nameUnsettable' ? { name: errors.name } : {}) }
  const msg = (m: Message | undefined) => (m ? t(m.key, m.vars) : undefined)
  // Another scenario of that name (editing: renaming onto it would merge the two).
  const existing = scenarios.data?.find((s) => s.name === name.trim() && s.name !== edit?.name)
  const renamedWithKept = edit && edit.kept.length > 0 && name.trim() !== edit.name

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
    updateStep(step.id, { status })
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
    const to = next.findIndex((s) => s.id === step.id)
    const answer = answerLabel(step)
    setAnnouncement(to === 0 ? t('builder.movedFirst', { answer }) : t('builder.moved', { answer, n: to + 1, state: stepState(next, to) || t('builder.step', { n: to + 1 }) }))
    setFlash((f) => ({ ids: [step.id, next[dir === 'up' ? to + 1 : to - 1].id], round: f.round + 1 }))
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
    if (edit) {
      // A step added while editing answers like the mocks around it: it starts with the last step's headers.
      setSteps((all) => [...all, { ...step, headers: (all.at(-1)?.headers ?? []).map((h) => ({ ...h })) }])
      setTouched(true)
      requestAnimationFrame(() => document.getElementById(id(`${step.id}-state`))?.focus())
      return
    }
    setSteps((all) => [...all, step])
    setTouched(true)
    requestAnimationFrame(() => document.getElementById(id(`${step.id}-state`))?.focus())
  }

  // Leaving with unsaved steps asks first.
  const dirtyRef = useRef(false)
  dirtyRef.current = edit ? touched || name !== edit.name : touched || name !== '' || free.url !== ''
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
    if (edit) {
      try {
        await saveEdit(base ?? edit)
      } finally {
        setSaving(false)
      }
      return
    }
    const created: StubMapping[] = []
    const scenarioName = name.trim()
    try {
      for (const create of toCreates(draft)) {
        try {
          created.push(await createFree.mutateAsync(create.stub))
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

  /**
   * Editing: writes the difference — creates, then updates (with versions), then deletes. A refused write undoes the
   * ones before it, newest first: created mocks are deleted, changed and deleted ones restored to their version (in
   * WireMock-only mode, which keeps no history, put back as they were under the same id).
   */
  type Done = { kind: 'created'; stub: StubMapping } | { kind: 'updated'; before: StubMapping; after: StubMapping } | { kind: 'deleted'; before: StubMapping }
  const version = (stub: StubMapping) => stub.metadata?.wiremockUi?.version ?? 0
  const noHistory = (error: unknown) => error instanceof ApiError && error.status === 404 && /version not found/i.test(error.message)
  const undo = async (done: Done[]): Promise<{ stub: StubMapping; reason: string }[]> => {
    const left: { stub: StubMapping; reason: string }[] = []
    for (const step of [...done].reverse()) {
      try {
        if (step.kind === 'created') await deleteMock.mutateAsync({ id: step.stub.id, version: version(step.stub) })
        else {
          try {
            await restoreMock(queryClient, step.before.id, version(step.before))
          } catch (error) {
            // Only "no such version" (no history: WireMock-only mode) falls back; anything else is reported.
            if (!noHistory(error)) throw error
            if (step.kind === 'updated') await updateMock.mutateAsync({ id: step.before.id, stub: asSaved(step.before), version: version(step.after) })
            else await putBack(step.before)
          }
        }
      } catch (error) {
        left.push({ stub: step.kind === 'created' ? step.stub : step.before, reason: messageOf(error, t('error.generic')).replace(/\.$/, '') })
      }
    }
    return left
  }
  /** A deleted mock back under its own id, owner and content (the import path keeps ids; it works without history). */
  const putBack = async (stub: StubMapping) => {
    const ui = stub.metadata?.wiremockUi
    const meta = { ...stub.metadata, wiremockUi: { ...(ui?.tags ? { tags: ui.tags } : {}), owner: ui?.owner ?? 'baseline' } }
    const { uuid: _uuid, ...rest } = stub as StubMapping & { uuid?: unknown }
    await apiFetch('/api/import', { method: 'POST', body: { integrations: [], catalog: [], mocks: [{ ...rest, metadata: meta }], oidcIdentities: [] } })
    await queryClient.invalidateQueries({ queryKey: queryKeys.mocks })
  }
  /** After a refused save: re-read the scenario and rebase the draft on its mocks as they are now. */
  const rebase = async (loaded: LoadedScenario): Promise<boolean> => {
    try {
      const fresh = await apiFetch<StubMapping[]>('/api/mocks', { query: { scenario: loaded.name } })
      const next = rebaseScenario(loaded, steps, fresh)
      setBase(next.base)
      setSteps(next.steps)
      setNotes(next.notes)
      return Object.keys(next.notes).length > 0
    } catch {
      setFailure((f) => (f ? `${f} ${t('builder.editReloadFailed')}` : f))
      return false
    }
  }
  /** A scenario left in a state no mock answers in any more (renamed or removed) is reset to Started. */
  const unstrand = async (scenarioName: string): Promise<string | undefined> => {
    try {
      const [{ scenarios: live }, stubs] = await Promise.all([
        apiFetch<{ scenarios: { name: string; state: string }[] }>('/api/scenarios'),
        apiFetch<StubMapping[]>('/api/mocks', { query: { scenario: scenarioName } }),
      ])
      const stranded = strandedState(live.find((s) => s.name === scenarioName)?.state, stubs, scenarioName)
      if (!stranded) return undefined
      await apiFetch('/api/scenarios/reset', { method: 'POST', body: { name: scenarioName } })
      return stranded
    } catch {
      return undefined
    }
  }
  const saveEdit = async (loaded: LoadedScenario) => {
    const scenarioName = name.trim()
    const changes = editChanges(loaded, draft)
    if (changes.length === 0) {
      toast.info(t('builder.noChanges'))
      return
    }
    const done: Done[] = []
    const what = (change: EditChange) =>
      change.kind === 'delete'
        ? t('builder.editRemoving', { name: change.before.name ?? change.before.id })
        : t('builder.editStep', { n: change.step, state: change.state })
    for (const change of changes) {
      try {
        if (change.kind === 'create') done.push({ kind: 'created', stub: await createFree.mutateAsync(change.stub) })
        else if (change.kind === 'update')
          done.push({ kind: 'updated', before: change.before, after: await updateMock.mutateAsync({ id: change.before.id, stub: change.stub, version: version(change.before) }) })
        else {
          await deleteMock.mutateAsync({ id: change.before.id, version: version(change.before) })
          done.push({ kind: 'deleted', before: change.before })
        }
      } catch (error) {
        const left = await undo(done)
        const vars = {
          what: what(change),
          message: messageOf(error, t('error.generic')).replace(/\.$/, ''),
          names: left.map((l) => `${l.stub.name ?? l.stub.id} (${l.reason})`).join(', '),
        }
        setFailure(t(left.length > 0 ? 'builder.editRollbackFailed' : 'builder.editFailed', vars))
        // Versions moved (the undo saves too) and someone may have saved meanwhile: the next try starts from now.
        if (await rebase(loaded)) setFailure((f) => (f ? `${f} ${t('builder.editRebased')}` : f))
        await queryClient.invalidateQueries({ queryKey: queryKeys.scenarios })
        return
      }
    }
    const stranded = await unstrand(scenarioName)
    await queryClient.invalidateQueries({ queryKey: queryKeys.scenarios })
    const count = (kind: EditChange['kind']) => changes.filter((c) => c.kind === kind).length
    const vars = { name: scenarioName, added: count('create'), changed: count('update'), removed: count('delete'), state: stranded ?? '' }
    toast.success(t(stranded ? 'builder.savedReset' : 'builder.saved', vars))
    leaving.current = true
    await navigate({ to: '/scenarios', search: { scenario: scenarioName } })
  }

  const preview = previewScenario(draft, (n) => t('builder.step', { n }))
  // Editing steps that match different requests: each step shows its own (a new step uses the one before it).
  const sourceOf = (i: number) => steps.slice(0, i + 1).reverse().find((s) => s.source)?.source ?? edit?.steps[0]?.source
  const stepRequest = (i: number) => (!edit || edit.sameRequest ? undefined : requestOf(sourceOf(i)))
  // The body editor follows the step's Content-Type, else the mock it was loaded from (or the step before it): JSON, or
  // nothing yet, gets the JSON editor; text a textarea. Never what is being typed, so the editor never swaps mid-word.
  const stepLanguage = (i: number): 'json' | 'xml' | null => {
    const type = steps[i]?.headers.find((h) => h.name.trim().toLowerCase() === 'content-type')?.value.toLowerCase()
    if (type) return /json/.test(type) ? 'json' : /xml/.test(type) ? 'xml' : null
    const response = (sourceOf(i)?.response ?? {}) as Record<string, unknown>
    if (response.jsonBody !== undefined || typeof response.body !== 'string' || response.body.trim() === '') return 'json'
    try {
      JSON.parse(response.body)
      return 'json'
    } catch {
      return response.body.trim().startsWith('<') ? 'xml' : null
    }
  }
  // Kept-as-is mocks that use a state this edit renames or removes.
  const lostForKept = base ? keptOnLostStates(base, steps) : { states: [], mocks: [] }

  return (
    <EditorShell
      title={edit ? t('builder.editTitle') : t('builder.title')}
      caption={edit ? t('builder.editCaption', { name: edit.name, count: edit.steps.length + edit.kept.length }) : t('builder.caption')}
      back={
        <Link to="/scenarios" search={edit ? { scenario: edit.name } : {}} className={backLinkClass}>
          <ArrowLeftIcon aria-hidden className="size-3.5" />
          {t('builder.back')}
        </Link>
      }
      notice={<Explainer editing={Boolean(edit)} />}
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
            <AlertTitle>{edit ? t('builder.editFailedTitle') : t('builder.failedTitle')}</AlertTitle>
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
            {renamedWithKept && (
              <p className="flex items-start gap-1.5 text-xs text-hazard-fg">
                <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>{t('builder.renameKept', { count: edit.kept.length, name: edit.name })}</span>
              </p>
            )}
            {shown.name && <FieldError id={id('name-error')}>{msg(shown.name)}</FieldError>}
          </Field>
        </Section>

        {edit ? (
          <Section title={t('builder.section.request')} hint={edit.sameRequest ? t('builder.editRequestHint') : t('builder.editRequestsHint')}>
            {edit.sameRequest && (
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                {firstRequest.method && <MethodBadge method={firstRequest.method} />}
                <span className="flex min-w-0 flex-col">
                  <span dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
                    {firstRequest.url ?? '—'}
                  </span>
                </span>
              </div>
            )}
            {edit.sameRequest && edit.steps[0]?.source && (
              <ScenarioRequest line={{ method: firstRequest.method, url: firstRequest.url, mockId: edit.steps[0].source.id }} stub={edit.steps[0].source} toolsOnly />
            )}
          </Section>
        ) : (
        <Section title={t('builder.section.request')} hint={t('builder.requestHint')}>
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
                  placeholder="/orders/1001"
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
        </Section>
        )}

        <Section title={t('builder.section.steps')} hint={t('builder.stepsHint')}>
          {steps.length > 1 && (
            <p id={id('move-note')} className="-mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>{t('builder.moveNote')}</span>
            </p>
          )}
          <ol aria-label={t('builder.stepsLabel')} className="flex flex-col gap-3">
            {steps.map((step, i) => (
              <StepCard
                key={step.id}
                id={(name) => id(`${step.id}-${name}`)}
                moveNoteId={steps.length > 1 ? id('move-note') : undefined}
                flash={flash.ids.includes(step.id) ? flash.round : 0}
                step={step}
                index={i}
                steps={steps}
                errors={shown.steps[step.id] ?? {}}
                msg={msg}
                bodyLanguage={stepLanguage(i)}
                note={notes[step.id]}
                exampleShown={false}
                catalog={false}
                request={stepRequest(i)}
                mockId={step.source?.id}
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
          <p aria-live="polite" className={announcement ? 'text-xs text-signal-fg' : 'sr-only'}>
            {announcement}
          </p>
          {lostForKept.mocks.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-hazard-fg">
              <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>
                {t('builder.keptLostStates', {
                  states: lostForKept.states.join(', '),
                  names: lostForKept.mocks.map((m) => m.name || m.id).join(', '),
                })}
              </span>
            </p>
          )}
        </Section>

        {edit && edit.kept.length > 0 && <KeptSection kept={edit.kept} />}

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-canvas/85 px-1 py-3 backdrop-blur">
          {attempted && hasErrors(errors) && (
            <p role="alert" className="me-auto text-xs text-mismatch">
              {t('builder.fixErrors')}
            </p>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {saving ? (edit ? t('builder.editSaving') : t('builder.saving')) : edit ? t('builder.editSave') : t('builder.save')}
          </Button>
        </div>
      </form>

      <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{edit ? t('builder.editLeaveBody') : t('builder.leaveBody')}</AlertDialogDescription>
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
  moveNoteId,
  flash,
  step,
  index,
  steps,
  errors,
  msg,
  bodyLanguage,
  exampleShown,
  catalog,
  request,
  mockId,
  note,
  onChange,
  onStatus,
  onMove,
  onRemove,
}: {
  id: (name: string) => string
  /** The "moving a step changes the order of answers" note the move buttons point at. */
  moveNoteId: string | undefined
  /** Non-zero right after a move swapped this card: the highlight replays for each new value. */
  flash: number
  step: BuilderStep
  index: number
  steps: BuilderStep[]
  errors: Partial<Record<StepField, Message>>
  msg: (m: Message | undefined) => string | undefined
  bodyLanguage: 'json' | 'xml' | null
  exampleShown: boolean
  /** A catalog request: its mocks reopen in Simple mode unless the step adds custom headers. */
  catalog: boolean
  /** Editing steps of different requests: the request this step matches (read-only). */
  request?: { method?: string; url?: string }
  /** Editing: the mock this step was loaded from. */
  mockId?: string
  /** Editing, after a refused save: someone changed or deleted this step's mock meanwhile. */
  note?: RebaseNote
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
      className="relative flex flex-col gap-4 rounded-md border border-line bg-surface-2/50 p-3 sm:p-4"
    >
      {flash > 0 && <div key={flash} aria-hidden className="move-flash pointer-events-none absolute inset-0 rounded-md" />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The position and the state it answers in: these stay put when answers are reordered. */}
        <h3 id={id('title')} tabIndex={-1} className="flex flex-wrap items-center gap-x-2 gap-y-1 outline-none">
          <span className="font-display text-lg leading-none font-semibold tracking-wide uppercase">{t('builder.step', { n })}</span>
          <span dir="ltr" className="rounded-sm border border-signal/40 bg-signal/10 px-1.5 py-0.5 font-mono text-xs text-signal-fg">
            {n} · {state || t('builder.noState')}
          </span>
          {target && (
            <span dir="ltr" className="font-mono text-xs text-muted-foreground">
              → {target}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {mockId && (
            <Button asChild variant="ghost" size="xs" className="text-muted-foreground">
              <Link to="/mocks/$id" params={{ id: mockId }} aria-label={t('builder.openMockOf', { n })}>
                {t('builder.openMock')}
                <ArrowUpRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          )}
          <Button
            id={id('up')}
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={first}
            aria-label={t('builder.moveUp', { n })}
            aria-describedby={moveNoteId}
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
            aria-describedby={moveNoteId}
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

      {note && (
        <p role="status" className="flex items-start gap-1.5 text-xs text-hazard-fg">
          <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{t(note === 'changed' ? 'builder.stepChanged' : 'builder.stepGone')}</span>
        </p>
      )}
      {request && (
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{t('builder.stepRequest')}</span>
          {request.method && <MethodBadge method={request.method} />}
          <span dir="ltr" className="truncate font-mono">
            {request.url ?? '—'}
          </span>
        </p>
      )}

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
            placeholder={first ? STARTED : 'shipped'}
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
              {step.moveTo.startsWith('state:') && (
                <SelectItem value={step.moveTo}>{t('builder.moveState', { state: step.moveTo.slice('state:'.length) })}</SelectItem>
              )}
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

      {/* The answer: what the arrows move between positions. */}
      <div role="group" aria-labelledby={id('answer')} className="flex flex-col gap-4 rounded-md border border-dashed border-line bg-canvas/40 p-3">
        <p id={id('answer')} className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          {t('builder.answerOf', { n })}
        </p>
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
            {exampleShown && <span className="text-xs text-muted-foreground">{t('editor.bodyFromExample', { status: step.status })}</span>}
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
      </div>
    </li>
  )
}

/** The order-status example: each step's state, its answer and the state it moves to. */
const EXAMPLE_STEPS = [
  { in: STARTED, answers: 'pending', moves: 'shipped' },
  { in: 'shipped', answers: 'shipped', moves: 'delivered' },
  { in: 'delivered', answers: 'delivered', moves: undefined },
]

/** The plain-words "what is a scenario" strip, with the order-status example as two calls. */
function Explainer({ editing = false }: { editing?: boolean }) {
  const t = useT()
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="glass-panel flex flex-col gap-3 rounded-md border border-line p-4 sm:p-5 md:flex-row md:items-center md:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 id={titleId} className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          <span aria-hidden="true">— </span>
          {t('builder.explainTitle')}
        </h2>
        <p className="text-sm leading-relaxed">{t('builder.explain')}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{editing ? t('builder.editExplainMore') : t('builder.explainMore')}</p>
      </div>
      <ol aria-hidden className="flex shrink-0 flex-col gap-1.5 font-mono text-xs">
        {EXAMPLE_STEPS.map((step, i) => (
          <li key={step.in} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm border border-line/70 bg-surface-2 px-2 py-1.5">
            <span className="text-muted-foreground">#{i + 1}</span>
            <span>
              {t('builder.chip.in')} <span className="text-signal-fg">{step.in}</span>
            </span>
            <span>→ {t('builder.chip.answers', { body: step.answers })}</span>
            {step.moves && <span className="text-muted-foreground">→ {t('builder.chip.moves', { state: step.moves })}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

const KEPT_REASON = { anyState: 'builder.keptAnyState', response: 'builder.keptResponse', sameState: 'builder.keptSameState' } as const

/** Mocks of the scenario the builder can't show as steps: listed with the reason, saved untouched. */
function KeptSection({ kept }: { kept: KeptMock[] }) {
  const t = useT()
  return (
    <Section title={t('builder.keptTitle', { count: kept.length })} hint={t('builder.keptHint')}>
      <ul className="flex flex-col gap-2">
        {kept.map(({ stub, reason }) => {
          const { method, url } = requestOf(stub)
          return (
            <li key={stub.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2/50 px-3 py-2">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-2">
                  {method && <MethodBadge method={method} />}
                  <span className="truncate text-sm font-medium">{stub.name || t('mocks.unnamed')}</span>
                </span>
                <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                  <span>
                    <span dir="ltr" className="font-mono">
                      {url}
                    </span>
                    {url && ' · '}
                    {t(KEPT_REASON[reason], { state: typeof stub.requiredScenarioState === 'string' ? stub.requiredScenarioState : '' })}
                  </span>
                </span>
              </span>
              <Button asChild variant="outline" size="xs">
                <Link to="/mocks/$id" params={{ id: stub.id }}>
                  {t('builder.openMock')}
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Link>
              </Button>
            </li>
          )
        })}
      </ul>
    </Section>
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
