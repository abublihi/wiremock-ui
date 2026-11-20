import { useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowLeftRightIcon, WorkflowIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { useEndpoints, useIntegrations, useRequest } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import type { ScenarioSeed } from '@/ui/lib/editor-sync'
import { stubFromRequest } from '@/ui/lib/prefill'
import { EditorShell } from './EditorShell'
import { EndpointInfo, EndpointPicker } from './EndpointPicker'
import { MockEditor } from './MockEditor'

/**
 * `from`: a logged request id to start from ("Create mock from this request").
 * `scenario` + `state`: a step added to a scenario ("Add a mock to this scenario"): the mock starts in it, answering in `state`.
 */
export type NewMockSearch = { integration?: string; endpoint?: string; mode?: 'json'; from?: string; scenario?: string; state?: string }

/** New mock: pick a catalog endpoint (kept in the URL) and fill the Simple form, or start from blank JSON. */
export function NewMockPage({ search, onSearchChange: setSearch }: { search: NewMockSearch; onSearchChange: (next: NewMockSearch) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const seed: ScenarioSeed | undefined = search.scenario ? { name: search.scenario, requiredState: search.state ?? 'Started' } : undefined
  // Picking or changing the endpoint keeps the scenario the mock is being added to.
  const onSearchChange = (next: NewMockSearch) => setSearch(seed ? { ...next, scenario: seed.name, state: seed.requiredState } : next)
  const notice = seed && <ScenarioNotice seed={seed} />
  const integrations = useIntegrations()
  const endpoints = useEndpoints(search.endpoint ? search.integration : undefined)
  const integration = integrations.data?.find((i) => i.key === search.integration)
  const endpoint = endpoints.data?.find((e) => e.key === search.endpoint)
  const open = (stub: StubMapping) => navigate({ to: '/mocks/$id', params: { id: stub.id } })

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
      <MockEditor key={`${integration.key}/${endpoint.key}`} catalog={{ integration, endpoint }} scenarioSeed={seed} onSaved={open} />
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
function ScenarioNotice({ seed }: { seed: ScenarioSeed }) {
  const t = useT()
  return (
    <Alert className="border-signal/40 bg-signal/5">
      <WorkflowIcon className="text-signal-fg" />
      <AlertTitle>{t('editor.scenarioBanner', { name: seed.name })}</AlertTitle>
      <AlertDescription className="text-xs">{t('editor.scenarioBannerHint', { state: seed.requiredState })}</AlertDescription>
    </Alert>
  )
}
