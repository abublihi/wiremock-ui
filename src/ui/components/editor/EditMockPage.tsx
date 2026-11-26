import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowUpRightIcon, FlaskConicalIcon, TerminalIcon, WorkflowIcon } from 'lucide-react'
import { groupOf } from '@/server/mocks/groups'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { useMock, useMockGroup } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useWiremockPublicUrl } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { curlFromStub } from '@/ui/lib/curl'
import { draftFromStub } from '@/ui/lib/test-request'
import { EditorShell } from './EditorShell'
import { type EditorMode, MockEditor } from './MockEditor'
import { TestPanel, copyCurl } from './TestPanel'

/**
 * Edit a mock, one with several responses included (its stubs open together). The editor works on the version it
 * opened: background refetches never replace a draft; only a save, a Reload (after a conflict) or a restore with no
 * unsaved changes moves it to another version.
 */
export function EditMockPage({ id, addValues }: { id: string; addValues?: (string | null)[] }) {
  const t = useT()
  const mock = useMock(id)
  const [opened, setOpened] = useState<StubMapping>()
  const [generation, setGeneration] = useState(0)
  const [mode, setMode] = useState<EditorMode>()
  // The stub under test: the mock, or one response of a mock with several responses.
  const [testing, setTesting] = useState<StubMapping | null>(null)
  const publicUrl = useWiremockPublicUrl()
  const navigate = useNavigate()
  if (!opened && mock.data) setOpened(mock.data)

  const meta = opened?.metadata?.wiremockUi
  const group = opened ? groupOf(opened) : undefined
  const groupStubs = useMockGroup(group?.id)

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
  if (!opened || (group && groupStubs.isPending)) {
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
  // After saving several responses: the page stays on this stub while it is still there, else follows the first one.
  const afterGroupSave = async (stubs: StubMapping[]) => {
    const kept = stubs.find((s) => s.id === opened.id)
    if (!kept) return void (await navigate({ to: '/mocks/$id', params: { id: stubs[0]!.id } }))
    if (group) await groupStubs.refetch()
    load(kept)
  }
  // After saving one stub's JSON: the group is read again.
  const afterSave = async (stub: StubMapping) => {
    if (group) await groupStubs.refetch()
    load(stub)
  }

  const stubs = group ? groupStubs.data : undefined
  const versions = stubs?.map((s) => `${s.id}:${s.metadata?.wiremockUi?.version ?? 0}`).join(',')
  const ref = t('editor.quickRef')
  const tested = testing ? draftFromStub(testing) : null
  const scenario = typeof opened.scenarioName === 'string' && opened.scenarioName !== '' ? opened.scenarioName : undefined

  return (
    <EditorShell
      valueTitle
      title={opened.name || opened.id}
      caption={stubs ? t('responses.editCaption', { count: stubs.length }) : t('editor.editCaption', { ref, version: meta?.version ?? 0 })}
      notice={scenario ? <ScenarioLink name={scenario} /> : undefined}
      actions={
        // Both act on the saved version: that is what WireMock serves. A mock with several responses tests each one.
        stubs ? undefined : (
          <>
            <Button variant="outline" size="sm" title={t('curl.savedHint')} onClick={() => void copyCurl(publicUrl === undefined ? undefined : curlFromStub(opened, undefined, publicUrl), t)}>
              <TerminalIcon data-icon="inline-start" />
              {t('curl.copy')}
            </Button>
            <Button size="sm" onClick={() => setTesting(opened)}>
              <FlaskConicalIcon data-icon="inline-start" />
              {t('test.open')}
            </Button>
          </>
        )
      }
    >
      {testing && tested && (
        <TestPanel
          key={testing.id}
          open
          onOpenChange={(o) => !o && setTesting(null)}
          mockId={testing.id}
          initial={tested.draft}
          pathIsPattern={tested.pathIsPattern}
        />
      )}
      <MockEditor
        key={`${opened.id}:${meta?.version ?? 0}:${generation}:${versions ?? ''}`}
        mock={opened}
        group={group && stubs ? { id: group.id, stubs } : undefined}
        addValues={addValues}
        initialMode={mode}
        onModeChange={setMode}
        onSaved={async (stub, savedIn) => {
          setMode(savedIn)
          await afterSave(stub)
        }}
        onGroupSaved={afterGroupSave}
        onReload={async () => {
          if (group) await groupStubs.refetch()
          await reload()
        }}
        // Restoring with no unsaved changes shows the restored version; a draft stays (its next save will conflict).
        onRestored={(stub, dirty) => !dirty && void afterSave(stub)}
        onTest={setTesting}
      />
    </EditorShell>
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
