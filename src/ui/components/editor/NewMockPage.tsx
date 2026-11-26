import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertCircleIcon, ArrowLeftRightIcon, BracesIcon, WorkflowIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { apiFetch } from '@/ui/api/client'
import { queryKeys, useMocks, useRequest, useUpdateMock } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Checkbox } from '@/ui/components/ui/checkbox'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { type ScenarioSeed, isScenarioNameSettable } from '@/ui/lib/editor-sync'
import { lastStateMocks, lastStepMocks, movedOn } from '@/ui/lib/scenario-builder'
import { stubFromRequest } from '@/ui/lib/prefill'
import { EditorShell } from './EditorShell'
import { MockEditor } from './MockEditor'

/**
 * `from`: a logged request id to start from ("Create mock from this request").
 * `scenario` + `state`: a step added to a scenario ("Add a mock to this scenario"): the mock starts in it, answering in `state`.
 * `after`: the scenario's current last state; once saved, the mocks answering there can be made to move on to the new state.
 */
export type NewMockSearch = {
  /** `json`: a blank stub in the JSON editor; `url` (or none): the form for a URL. */
  mode?: 'json' | 'url'
  from?: string
  scenario?: string
  state?: string
  after?: string
}

/** New mock: the form for a URL (it can grow into several responses), or blank JSON, or a logged request's copy. */
export function NewMockPage({ search, onSearchChange: setSearch }: { search: NewMockSearch; onSearchChange: (next: NewMockSearch) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const updateMock = useUpdateMock()
  const seed: ScenarioSeed | undefined = search.scenario ? { name: search.scenario, requiredState: search.state ?? 'Started' } : undefined
  const after = seed ? search.after : undefined
  // Switching between the form and JSON keeps the scenario the mock is being added to.
  const scenarioSearch = seed ? { scenario: seed.name, state: seed.requiredState, ...(after ? { after } : {}) } : {}
  const onSearchChange = (next: NewMockSearch) => setSearch({ ...next, ...scenarioSearch })
  // The state the new step answers in, as the Simple form has it now (editable there).
  const [target, setTarget] = useState(seed?.requiredState ?? '')
  const [linkLast, setLinkLast] = useState(true)
  // Before saving, the new step's request is not known yet: offer the move when some mock answers in the last state.
  // The save then moves only those matching the same request.
  const scenarioMocks = useMocks({ scenario: seed?.name }, { enabled: Boolean(seed && after) })
  const lastCandidates =
    seed && after && scenarioMocks.data
      ? lastStateMocks(scenarioMocks.data, seed.name, after).length
      : undefined
  const canMoveLast = lastCandidates !== 0
  const notice = seed && (
    <ScenarioNotice seed={seed} after={after} target={target} linkLast={linkLast} candidates={lastCandidates} onLinkLast={setLinkLast} />
  )
  const onFormChange = (form: { scenario: { enabled: boolean; requiredState: string } }) =>
    setTarget(form.scenario.enabled ? form.scenario.requiredState.trim() || 'Started' : '')

  /** The old last step moves the scenario to the new step's state (the normal update path, with versions). */
  const moveLastStepOn = async (saved: StubMapping) => {
    const to = typeof saved.requiredScenarioState === 'string' ? saved.requiredScenarioState : ''
    if (!seed || !after || saved.scenarioName !== seed.name || !to || to === after) return
    let stubs: StubMapping[]
    try {
      stubs = await apiFetch<StubMapping[]>('/api/mocks', { query: { scenario: seed.name } })
    } catch (error) {
      toast.error(t('editor.lastStepLoadFailed', { scenario: seed.name, after, state: to }), {
        description: error instanceof Error ? error.message : undefined,
        duration: Number.POSITIVE_INFINITY,
      })
      return
    }
    const last = lastStepMocks(stubs, seed.name, after, saved)
    if (last.length === 0) toast.info(t('editor.lastStepNone', { after, state: to }))
    for (const old of last) {
      const name = old.name ?? old.id
      try {
        await updateMock.mutateAsync({ id: old.id, stub: movedOn(old, to), version: old.metadata?.wiremockUi?.version ?? 0 })
        toast.success(t('editor.lastStepMoved', { name, state: to }))
      } catch (error) {
        toast.error(t('editor.lastStepFailed', { name, state: to }), {
          description: error instanceof Error ? error.message : undefined,
          duration: Number.POSITIVE_INFINITY,
          action: { label: t('builder.openIt'), onClick: () => void navigate({ to: '/mocks/$id', params: { id: old.id } }) },
        })
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.scenarios })
  }
  const open = async (stub: StubMapping) => {
    if (linkLast && canMoveLast) await moveLastStepOn(stub)
    await navigate({ to: '/mocks/$id', params: { id: stub.id } })
  }

  const toForm = (
    <Button variant="outline" size="sm" onClick={() => onSearchChange({})}>
      <ArrowLeftRightIcon data-icon="inline-start" />
      {t('editor.useForm')}
    </Button>
  )
  const toJson = (
    <Button variant="outline" size="sm" onClick={() => onSearchChange({ mode: 'json' })}>
      <BracesIcon data-icon="inline-start" />
      {t('editor.useJson')}
    </Button>
  )

  if (search.from) {
    return <FromRequest id={search.from} change={toForm} seed={seed} notice={notice} onSaved={open} />
  }

  if (search.mode === 'json') {
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.blankCaption')} actions={toForm} notice={notice}>
        {/* Keyed by mode: switching between the form and JSON starts a fresh editor, never the other one's state. */}
        <MockEditor key="json" simpleUnavailable={t('editor.blankUnavailable')} scenarioSeed={seed} onSaved={open} />
      </EditorShell>
    )
  }

  return (
    <EditorShell title={t('editor.newTitle')} caption={t('editor.quickCaption')} actions={toJson} notice={notice}>
      <MockEditor key="url" quick scenarioSeed={seed} onFormChange={seed ? onFormChange : undefined} onSaved={open} />
    </EditorShell>
  )
}

/** A new free-form mock prefilled from a logged request: its method, path and JSON body, answering 200. */
function FromRequest({
  id,
  change,
  seed,
  notice,
  onSaved,
}: {
  id: string
  change: React.ReactNode
  seed?: ScenarioSeed
  notice?: React.ReactNode
  onSaved: (stub: StubMapping) => void
}) {
  const t = useT()
  const request = useRequest(id)
  if (request.isPending) {
    return (
      <EditorShell title={t('editor.newTitle')} caption="//" actions={change} notice={notice}>
        <Skeleton className="h-96 w-full" />
      </EditorShell>
    )
  }
  if (request.isError) {
    return (
      <EditorShell title={t('editor.newTitle')} caption="//" actions={change} notice={notice}>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('editor.fromRequestFailed')}</AlertTitle>
          <AlertDescription>{request.error.message}</AlertDescription>
        </Alert>
      </EditorShell>
    )
  }
  const { method, url } = request.data.request
  return (
    <EditorShell title={t('editor.newTitle')} caption={t('editor.fromRequestCaption', { method, url })} actions={change} notice={notice}>
      <MockEditor key={id} initialStub={stubFromRequest(request.data)} scenarioSeed={seed} simpleUnavailable={t('editor.fromRequestUnavailable')} onSaved={onSaved} />
    </EditorShell>
  )
}

/** "Adding a step to scenario …": why the Scenario section starts filled in. */
function ScenarioNotice({
  seed,
  after,
  target,
  linkLast,
  candidates,
  onLinkLast,
}: {
  seed: ScenarioSeed
  /** The scenario's current last state, when the mock is added after it. */
  after?: string
  /** The state the new mock answers in now. */
  target: string
  linkLast: boolean
  /** Mocks that could be the last step (undefined while loading); none: nothing to move on, so no checkbox. */
  candidates?: number
  onLinkLast: (on: boolean) => void
}) {
  const t = useT()
  const id = useId()
  const canLink = Boolean(after) && target !== '' && target !== after
  return (
    <Alert className="border-signal/40 bg-signal/5">
      <WorkflowIcon className="text-signal-fg" />
      <AlertTitle>{t('editor.scenarioBanner', { name: seed.name })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2 text-xs">
        <p>{after ? t('editor.scenarioBannerAfter', { state: target || seed.requiredState, after }) : t('editor.scenarioBannerHint', { state: seed.requiredState })}</p>
        {after && candidates === 0 && (
          <p role="status" className="text-hazard-fg">
            {t('editor.scenarioNoLastStep', { after, state: target || seed.requiredState })}
          </p>
        )}
        {after && candidates !== 0 && (
          <div className="flex items-start gap-2 text-foreground">
            <Checkbox
              id={id}
              className="mt-0.5"
              checked={linkLast && canLink}
              disabled={!canLink}
              aria-describedby={`${id}-hint`}
              onCheckedChange={(on) => onLinkLast(on === true)}
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor={id} className="font-medium">
                {t('editor.scenarioLinkLast', { state: target || seed.requiredState })}
              </label>
              <span id={`${id}-hint`} className="text-muted-foreground">
                {t('editor.scenarioLinkLastHint', { after, state: target || seed.requiredState })}
              </span>
            </div>
          </div>
        )}
        {after && target !== '' && !isScenarioNameSettable(target) && (
          <p role="alert" className="text-hazard-fg">
            {t('editor.scenarioStateUnsettable')}
          </p>
        )}
      </AlertDescription>
    </Alert>
  )
}
