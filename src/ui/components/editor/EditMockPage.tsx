import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowUpRightIcon, FlaskConicalIcon, ListTreeIcon, TerminalIcon, WorkflowIcon } from 'lucide-react'
import { groupOf } from '@/server/mocks/groups'
import { type GroupForm, byLabel, groupFormFromStubs, groupInput } from '@/ui/lib/groups'
import { GroupEditor } from './GroupEditor'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { useEndpoints, useIntegrations, useMock, useMockGroup, useSaveMockGroup } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useWiremockPublicUrl } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { curlFromStub } from '@/ui/lib/curl'
import { draftFromStub } from '@/ui/lib/test-request'
import { EditorShell } from './EditorShell'
import { EndpointInfo } from './EndpointPicker'
import { type EditorMode, MockEditor } from './MockEditor'
import { TestPanel, copyCurl } from './TestPanel'

/**
 * Edit a mock. The editor works on the version it opened: background refetches never replace a draft;
 * only a save, a Reload (after a conflict) or a restore with no unsaved changes moves it to another version.
 */
export function EditMockPage({ id }: { id: string }) {
  const t = useT()
  const mock = useMock(id)
  const [opened, setOpened] = useState<StubMapping>()
  const [generation, setGeneration] = useState(0)
  const [mode, setMode] = useState<EditorMode>()
  const [testing, setTesting] = useState(false)
  const publicUrl = useWiremockPublicUrl()
  const navigate = useNavigate()
  if (!opened && mock.data) setOpened(mock.data)

  const meta = opened?.metadata?.wiremockUi
  const integrations = useIntegrations()
  const endpoints = useEndpoints(meta?.endpoint ? meta.integration : undefined)
  // A mock with several responses opens as one: every stub of its group.
  const group = opened ? groupOf(opened) : undefined
  const groupStubs = useMockGroup(group?.id)
  const saveGroup = useSaveMockGroup()
  /** A URL mock growing into one with several responses (not saved yet). */
  const [growing, setGrowing] = useState<GroupForm | null>(null)

  if (!opened && mock.isError) {
    const missing = mock.error instanceof ApiError && mock.error.status === 404
    return (
      <EditorShell title={id} caption="//">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('editor.loadFailed')}</AlertTitle>
          <AlertDescription>{missing ? t('editor.notFound') : mock.error.message}</AlertDescription>
        </Alert>
      </EditorShell>
    )
  }
  if (!opened || (meta?.endpoint && (integrations.isPending || endpoints.isPending)) || (group && groupStubs.isPending)) {
    return (
      <EditorShell title={opened?.name ?? '…'} caption="//">
        <Skeleton className="h-96 w-full" />
      </EditorShell>
    )
  }

  const load = (stub: StubMapping) => {
    setOpened(stub)
    setGeneration((g) => g + 1)
  }
  const reload = async () => {
    const result = await mock.refetch()
    if (result.error) throw result.error
    if (result.data) load(result.data)
  }

  // After a group save: the page follows the group (its first response, which may be another stub now).
  const afterGroupSave = async (stubs: StubMapping[]) => {
    const first = stubs[0]!
    if (first.id !== opened.id) await navigate({ to: '/mocks/$id', params: { id: first.id } })
    else {
      await groupStubs.refetch()
      load(first)
    }
  }

  if (growing) {
    return (
      <EditorShell valueTitle title={growing.name || opened.name || opened.id} caption={t('groups.editCaption', { count: growing.rows.length + (growing.fallback.on ? 1 : 0), by: byLabel(growing.by) })}>
        <GroupEditor
          initial={growing}
          cancelLabel={t('groups.backToOne')}
          onCancel={() => setGrowing(null)}
          onSave={async (form) => {
            const stubs = await saveGroup.mutateAsync({ input: groupInput(form), replaces: { id: opened.id, version: meta?.version ?? 0 } })
            await afterGroupSave(stubs)
            setGrowing(null)
            return stubs
          }}
        />
      </EditorShell>
    )
  }

  const groupForm = group && groupStubs.data ? groupFormFromStubs(groupStubs.data) : null
  if (group && groupStubs.data && groupForm) {
    const versions = Object.fromEntries(groupStubs.data.map((s) => [s.id, s.metadata?.wiremockUi?.version ?? 0]))
    return (
      <EditorShell
        valueTitle
        title={opened.name || opened.id}
        caption={t('groups.editCaption', { count: groupStubs.data.length, by: byLabel(group.by) })}
      >
        <GroupEditor
          key={JSON.stringify(versions)}
          initial={groupForm}
          onSave={async (form) => {
            const stubs = await saveGroup.mutateAsync({ id: group.id, input: groupInput(form), versions })
            await afterGroupSave(stubs)
            return stubs
          }}
        />
      </EditorShell>
    )
  }

  const integration = integrations.data?.find((i) => i.key === meta?.integration)
  const endpoint = endpoints.data?.find((e) => e.key === meta?.endpoint)
  const catalog = integration && endpoint ? { integration, endpoint } : undefined
  const ref = catalog ? t('editor.endpointRef', { integration: catalog.integration.name, endpoint: catalog.endpoint.name }) : meta?.integration ? opened.id : t('editor.quickRef')
  const tested = draftFromStub(opened, endpoint)
  const scenario = typeof opened.scenarioName === 'string' && opened.scenarioName !== '' ? opened.scenarioName : undefined
  const unavailable = meta?.endpoint ? t('editor.endpointMissing', { ref: `${meta.integration}/${meta.endpoint}` }) : t('editor.noCatalog')

  return (
    <EditorShell
      valueTitle
      title={opened.name || opened.id}
      caption={t('editor.editCaption', { ref, version: meta?.version ?? 0 })}
      aside={catalog && <EndpointInfo integration={catalog.integration} endpoint={catalog.endpoint} />}
      notice={scenario ? <ScenarioLink name={scenario} /> : group ? <GroupNotice /> : undefined}
      actions={
        // Both act on the saved version: that is what WireMock serves.
        <>
          <Button variant="outline" size="sm" title={t('curl.savedHint')} onClick={() => void copyCurl(publicUrl === undefined ? undefined : curlFromStub(opened, endpoint, publicUrl), t)}>
            <TerminalIcon data-icon="inline-start" />
            {t('curl.copy')}
          </Button>
          <Button size="sm" onClick={() => setTesting(true)}>
            <FlaskConicalIcon data-icon="inline-start" />
            {t('test.open')}
          </Button>
        </>
      }
    >
      <TestPanel open={testing} onOpenChange={setTesting} mockId={opened.id} initial={tested.draft} pathIsPattern={tested.pathIsPattern} />
      <MockEditor
        key={`${opened.id}:${meta?.version ?? 0}:${generation}`}
        mock={opened}
        catalog={catalog}
        simpleUnavailable={unavailable}
        initialMode={mode}
        onModeChange={setMode}
        onSaved={(stub, savedIn) => {
          setMode(savedIn)
          load(stub)
        }}
        onReload={reload}
        // Restoring with no unsaved changes shows the restored version; a draft stays (its next save will conflict).
        onRestored={(stub, dirty) => !dirty && load(stub)}
        onAddResponse={group ? undefined : setGrowing}
      />
    </EditorShell>
  )
}

/** One response of a mock with several responses the editor can't show as a whole: edited here as JSON, on its own. */
function GroupNotice() {
  const t = useT()
  return (
    <p className="flex items-center gap-2 rounded-md border border-hazard/40 bg-hazard/5 px-3 py-2 text-xs">
      <ListTreeIcon aria-hidden className="size-3.5 shrink-0 text-hazard-fg" />
      {t('groups.cantShow')}
    </p>
  )
}

/** A step mock: it is one of its scenario's mocks, which the builder edits together. */
function ScenarioLink({ name }: { name: string }) {
  const t = useT()
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-signal/30 bg-signal/5 px-3 py-2 text-xs">
      <WorkflowIcon aria-hidden className="size-3.5 shrink-0 text-signal-fg" />
      <span>
        {t('editor.partOfScenario')}{' '}
        <span dir="ltr" className="font-mono font-semibold">
          {name}
        </span>
      </span>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <Link to="/scenarios/$name/edit" params={{ name }} className="inline-flex items-center gap-1 text-signal-fg hover:underline">
        {t('editor.editWholeScenario')}
        <ArrowUpRightIcon aria-hidden className="size-3" />
      </Link>
    </p>
  )
}
