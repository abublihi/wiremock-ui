import { useState } from 'react'
import { AlertCircleIcon, FlaskConicalIcon, TerminalIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { useEndpoints, useIntegrations, useMock } from '@/ui/api/queries'
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
  if (!opened && mock.data) setOpened(mock.data)

  const meta = opened?.metadata?.wiremockUi
  const integrations = useIntegrations()
  const endpoints = useEndpoints(meta?.endpoint ? meta.integration : undefined)

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
  if (!opened || (meta?.endpoint && (integrations.isPending || endpoints.isPending))) {
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

  const integration = integrations.data?.find((i) => i.key === meta?.integration)
  const endpoint = endpoints.data?.find((e) => e.key === meta?.endpoint)
  const catalog = integration && endpoint ? { integration, endpoint } : undefined
  const ref = catalog ? t('editor.endpointRef', { integration: catalog.integration.name, endpoint: catalog.endpoint.name }) : opened.id
  const tested = draftFromStub(opened, endpoint)
  const unavailable = meta?.endpoint ? t('editor.endpointMissing', { ref: `${meta.integration}/${meta.endpoint}` }) : t('editor.noCatalog')

  return (
    <EditorShell
      title={opened.name || opened.id}
      caption={t('editor.editCaption', { ref, version: meta?.version ?? 0 })}
      aside={catalog && <EndpointInfo integration={catalog.integration} endpoint={catalog.endpoint} />}
      actions={
        // Both act on the saved version: that is what WireMock serves.
        <>
          <Button variant="outline" size="sm" onClick={() => void copyCurl(publicUrl === undefined ? undefined : curlFromStub(opened, endpoint, publicUrl), t)}>
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
      />
    </EditorShell>
  )
}
