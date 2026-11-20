import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertCircleIcon, ArrowLeftRightIcon, WorkflowIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { apiFetch } from '@/ui/api/client'
import { queryKeys, useEndpoints, useIntegrations, useRequest, useUpdateMock } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Checkbox } from '@/ui/components/ui/checkbox'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { type ScenarioSeed, isScenarioNameSettable } from '@/ui/lib/editor-sync'
import { lastStepMocks, movedOn } from '@/ui/lib/scenario-builder'
import { stubFromRequest } from '@/ui/lib/prefill'
import { EditorShell } from './EditorShell'
import { EndpointInfo, EndpointPicker } from './EndpointPicker'
import { MockEditor } from './MockEditor'

/**
 * `from`: a logged request id to start from ("Create mock from this request").
 * `scenario` + `state`: a step added to a scenario ("Add a mock to this scenario"): the mock starts in it, answering in `state`.
 * `after`: the scenario's current last state; once saved, the mocks answering there can be made to move on to the new state.
 */
export type NewMockSearch = {
  integration?: string
  endpoint?: string
  mode?: 'json'
  from?: string
  scenario?: string
  state?: string
  after?: string
}

/** New mock: pick a catalog endpoint (kept in the URL) and fill the Simple form, or start from blank JSON. */
export function NewMockPage({ search, onSearchChange: setSearch }: { search: NewMockSearch; onSearchChange: (next: NewMockSearch) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const updateMock = useUpdateMock()
  const seed: ScenarioSeed | undefined = search.scenario ? { name: search.scenario, requiredState: search.state ?? 'Started' } : undefined
  const after = seed ? search.after : undefined
  // Picking or changing the endpoint keeps the scenario the mock is being added to.
  const onSearchChange = (next: NewMockSearch) =>
    setSearch(seed ? { ...next, scenario: seed.name, state: seed.requiredState, ...(after ? { after } : {}) } : next)
  // The state the new step answers in, as the Simple form has it now (editable there).
  const [target, setTarget] = useState(seed?.requiredState ?? '')
  const [linkLast, setLinkLast] = useState(true)
  const notice = seed && <ScenarioNotice seed={seed} after={after} target={target} linkLast={linkLast} onLinkLast={setLinkLast} />
  const onFormChange = (form: { scenario: { enabled: boolean; requiredState: string } }) =>
    setTarget(form.scenario.enabled ? form.scenario.requiredState.trim() || 'Started' : '')

  /** The old last step moves the scenario to the new step's state (the normal update path, with versions). */
  const moveLastStepOn = async (saved: StubMapping) => {
    const to = typeof saved.requiredScenarioState === 'string' ? saved.requiredScenarioState : ''
    if (!seed || !after || saved.scenarioName !== seed.name || !to || to === after) return
    let stubs: StubMapping[]
    try {
      stubs = await apiFetch<StubMapping[]>('/api/mocks')
    } catch (error) {
      toast.error(t('editor.lastStepLoadFailed', { scenario: seed.name, after, state: to }), {
        description: error instanceof Error ? error.message : undefined,
        duration: Number.POSITIVE_INFINITY,
      })
      return
    }
    for (const old of lastStepMocks(stubs, seed.name, after, saved.id)) {
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
  const integrations = useIntegrations()
  const endpoints = useEndpoints(search.endpoint ? search.integration : undefined)
  const integration = integrations.data?.find((i) => i.key === search.integration)
  const endpoint = endpoints.data?.find((e) => e.key === search.endpoint)
  const open = async (stub: StubMapping) => {
    if (linkLast) await moveLastStepOn(stub)
    await navigate({ to: '/mocks/$id', params: { id: stub.id } })
  }

  const change = (label: string) => (
    <Button variant="outline" size="sm" onClick={() => onSearchChange({})}>
      <ArrowLeftRightIcon data-icon="inline-start" />
      {label}
    </Button>
  )

  if (search.from) {
    return <FromRequest id={search.from} change={change(t('editor.pickInstead'))} seed={seed} notice={notice} onSaved={open} />
  }

  if (search.mode === 'json') {
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.blankCaption')} actions={change(t('editor.pickInstead'))} notice={notice}>
        <MockEditor simpleUnavailable={t('editor.noCatalog')} scenarioSeed={seed} onSaved={open} />
      </EditorShell>
    )
  }

  if (!search.integration || !search.endpoint) {
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.newCaption')} notice={notice}>
        <EndpointPicker onPick={(i, e) => onSearchChange({ integration: i, endpoint: e })} onBlank={() => onSearchChange({ mode: 'json' })} />
      </EditorShell>
    )
  }

  if (integrations.isPending || endpoints.isPending) {
    return (
      <EditorShell title={t('editor.newTitle')} caption="//" notice={notice}>
        <Skeleton className="h-96 w-full" />
      </EditorShell>
    )
  }
  if (!integration || !endpoint) {
    const error = integrations.error ?? endpoints.error
    return (
      <EditorShell title={t('editor.newTitle')} caption="//" actions={change(t('editor.changeEndpoint'))} notice={notice}>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{error ? t('editor.pickLoadFailed') : t('editor.endpointMissing', { ref: `${search.integration}/${search.endpoint}` })}</AlertTitle>
          {error && <AlertDescription>{error.message}</AlertDescription>}
        </Alert>
      </EditorShell>
    )
  }

  const ref = t('editor.endpointRef', { integration: integration.name, endpoint: endpoint.name })
  return (
    <EditorShell
      title={t('editor.newTitle')}
      caption={`// ${ref}`}
      actions={change(t('editor.changeEndpoint'))}
      aside={<EndpointInfo integration={integration} endpoint={endpoint} />}
      notice={notice}
    >
      <p className="sr-only">{ref}</p>
      {/* "Change endpoint" navigates, so the editor's unsaved-changes guard covers it. */}
      <MockEditor
        key={`${integration.key}/${endpoint.key}`}
        catalog={{ integration, endpoint }}
        scenarioSeed={seed}
        onFormChange={seed ? onFormChange : undefined}
        onSaved={open}
      />
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
  onLinkLast,
}: {
  seed: ScenarioSeed
  /** The scenario's current last state, when the mock is added after it. */
  after?: string
  /** The state the new mock answers in now. */
  target: string
  linkLast: boolean
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
        {after && (
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
              {target !== '' && !isScenarioNameSettable(target) && (
                <span role="alert" className="text-hazard-fg">
                  {t('editor.scenarioStateUnsettable')}
                </span>
              )}
            </div>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
