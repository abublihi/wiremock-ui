import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertCircleIcon, ArrowLeftRightIcon, BracesIcon, DatabaseIcon, LinkIcon, PlusIcon, WorkflowIcon } from 'lucide-react'
import type { Integration } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { apiFetch } from '@/ui/api/client'
import { queryKeys, useEndpoints, useIntegrations, useMocks, useRequest, useUpdateMock } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Checkbox } from '@/ui/components/ui/checkbox'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import type { ScenarioReturn } from '@/ui/components/catalog/EndpointPage'
import { IntegrationForm } from '@/ui/components/catalog/IntegrationForm'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { type ScenarioSeed, isScenarioNameSettable, linkOf } from '@/ui/lib/editor-sync'
import { lastStateMocks, lastStepMocks, movedOn } from '@/ui/lib/scenario-builder'
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
  /** `json`: a blank free-form stub; `url`: a quick mock of a URL, without an integration. */
  mode?: 'json' | 'url'
  from?: string
  scenario?: string
  state?: string
  after?: string
}

/**
 * New mock: pick an integration endpoint (kept in the URL) and fill the Simple form, mock a URL directly (the quick
 * form), or start from blank JSON. With no integrations yet, an empty state offers all three.
 */
export function NewMockPage({ search, onSearchChange: setSearch }: { search: NewMockSearch; onSearchChange: (next: NewMockSearch) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const updateMock = useUpdateMock()
  const seed: ScenarioSeed | undefined = search.scenario ? { name: search.scenario, requiredState: search.state ?? 'Started' } : undefined
  const after = seed ? search.after : undefined
  // Picking or changing the endpoint keeps the scenario the mock is being added to.
  // The scenario context as search params, carried through every way out and back (an endpoint added on its page).
  const scenarioSearch = seed ? { scenario: seed.name, state: seed.requiredState, ...(after ? { after } : {}) } : {}
  const onSearchChange = (next: NewMockSearch) => setSearch({ ...next, ...scenarioSearch })
  // The state the new step answers in, as the Simple form has it now (editable there).
  const [target, setTarget] = useState(seed?.requiredState ?? '')
  const [linkLast, setLinkLast] = useState(true)
  // Before saving, the new step's request is not known yet: offer the move only when some mock of the same endpoint
  // (any mock, without one) answers in the last state. The save then moves only those matching the same request.
  const scenarioMocks = useMocks({ scenario: seed?.name }, { enabled: Boolean(seed && after) })
  const lastCandidates =
    seed && after && scenarioMocks.data
      ? lastStateMocks(scenarioMocks.data, seed.name, after).filter((s) => {
          if (!search.integration || !search.endpoint || search.mode === 'json' || search.from) return true
          const link = linkOf(s)
          return link?.integration === search.integration && link.endpoint === search.endpoint
        }).length
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
  const integrations = useIntegrations()
  const endpoints = useEndpoints(search.endpoint ? search.integration : undefined)
  const integration = integrations.data?.find((i) => i.key === search.integration)
  const endpoint = endpoints.data?.find((e) => e.key === search.endpoint)
  const open = async (stub: StubMapping) => {
    if (linkLast && canMoveLast) await moveLastStepOn(stub)
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

  if (search.mode === 'url') {
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.quickCaption')} actions={change(t('editor.pickInstead'))} notice={notice}>
        <MockEditor quick scenarioSeed={seed} onFormChange={seed ? onFormChange : undefined} onSaved={open} />
      </EditorShell>
    )
  }

  if (!search.integration || !search.endpoint) {
    const toQuick = () => onSearchChange({ mode: 'url' })
    const toBlank = () => onSearchChange({ mode: 'json' })
    if (integrations.data?.length === 0) {
      return (
        <EditorShell title={t('editor.newTitle')} caption={t('editor.noIntegrations.caption')} notice={notice}>
          <NoIntegrations onQuick={toQuick} onBlank={toBlank} scenario={scenarioSearch} />
        </EditorShell>
      )
    }
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.newCaption')} notice={notice}>
        <EndpointPicker
          onPick={(i, e) => onSearchChange({ integration: i, endpoint: e })}
          onQuick={toQuick}
          onBlank={toBlank}
          addReturnsHere={scenarioSearch}
        />
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

/**
 * The new-mock page before any integration exists: what an integration is for, and three ways on — add one (then its
 * first endpoint, then back here with it picked), mock a URL directly, or write the stub JSON by hand.
 */
function NoIntegrations({ onQuick, onBlank, scenario }: { onQuick: () => void; onBlank: () => void; scenario: ScenarioReturn }) {
  const t = useT()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const hintId = useId()
  const added = (integration: Integration) =>
    void navigate({ to: '/integrations/$key/endpoints/new', params: { key: integration.key }, search: { next: 'mock', ...scenario } })
  return (
    <Empty className="rounded-md border border-dashed border-line">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon">
          <DatabaseIcon />
        </EmptyMedia>
        <EmptyTitle>{t('editor.noIntegrations.title')}</EmptyTitle>
        <EmptyDescription>{t('editor.noIntegrations.body')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-lg gap-3">
        <div className="flex flex-col items-center gap-1">
          <Button onClick={() => setAdding(true)} aria-describedby={hintId}>
            <PlusIcon data-icon="inline-start" />
            {t('editor.noIntegrations.add')}
          </Button>
          <span id={hintId} className="text-[11px] text-muted-foreground">
            {t('editor.noIntegrations.addHint')}
          </span>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2">
          <ChoiceButton icon={<LinkIcon />} title={t('editor.noIntegrations.url')} hint={t('editor.noIntegrations.urlHint')} onClick={onQuick} />
          <ChoiceButton icon={<BracesIcon />} title={t('editor.noIntegrations.blank')} hint={t('editor.noIntegrations.blankHint')} onClick={onBlank} />
        </div>
      </EmptyContent>
      <IntegrationForm open={adding} onOpenChange={setAdding} onSaved={added} />
    </Empty>
  )
}

/** A secondary way on: a bordered button with a title and one line of hint. */
function ChoiceButton({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glow-border flex flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-2.5 text-start outline-none transition-colors hover:border-signal/40 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-2 text-sm font-medium [&>svg]:size-3.5 [&>svg]:text-signal-fg">
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
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
