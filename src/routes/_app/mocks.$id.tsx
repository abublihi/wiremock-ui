import { createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, InfoIcon } from 'lucide-react'
import { ApiError } from '@/ui/api/client'
import { useEndpoints, useIntegrations, useMock } from '@/ui/api/queries'
import { EditorShell } from '@/ui/components/editor/EditorShell'
import { EndpointInfo } from '@/ui/components/editor/EndpointPicker'
import { SimpleEditor } from '@/ui/components/editor/SimpleEditor'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { fromStub } from '@/ui/lib/editor-sync'

export const Route = createFileRoute('/_app/mocks/$id')({
  component: EditMockRoute,
})

function EditMockRoute() {
  const { id } = Route.useParams()
  return <EditMockPage id={id} />
}

/** Edit a mock. Catalog mocks open in Simple mode; anything Simple mode can't show says so (Advanced: Task 5). */
export function EditMockPage({ id }: { id: string }) {
  const t = useT()
  const mock = useMock(id)
  const meta = mock.data?.metadata?.wiremockUi
  const integrations = useIntegrations()
  const endpoints = useEndpoints(meta?.endpoint ? meta.integration : undefined)

  if (mock.isError) {
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
  if (mock.isPending || (meta?.endpoint && (integrations.isPending || endpoints.isPending))) {
    return (
      <EditorShell title={mock.data?.name ?? '…'} caption="//">
        <Skeleton className="h-96 w-full" />
      </EditorShell>
    )
  }

  const stub = mock.data
  const title = stub.name || stub.id
  const integration = integrations.data?.find((i) => i.key === meta?.integration)
  const endpoint = endpoints.data?.find((e) => e.key === meta?.endpoint)
  const ref = integration && endpoint ? t('editor.endpointRef', { integration: integration.name, endpoint: endpoint.name }) : stub.id
  const caption = t('editor.editCaption', { ref, version: meta?.version ?? 0 })

  if (!meta?.endpoint || !integration || !endpoint) {
    return (
      <EditorShell title={title} caption={caption}>
        <Alert>
          <InfoIcon />
          <AlertTitle>
            {meta?.endpoint ? t('editor.endpointMissing', { ref: `${meta.integration}/${meta.endpoint}` }) : t('editor.noCatalog')}
          </AlertTitle>
          {/* Task 5 opens these in Advanced mode. */}
          <AlertDescription>{t('editor.cantShowAction')}</AlertDescription>
        </Alert>
      </EditorShell>
    )
  }

  const form = fromStub(stub, endpoint)
  const aside = <EndpointInfo integration={integration} endpoint={endpoint} />
  if (!form) {
    return (
      <EditorShell title={title} caption={caption} aside={aside}>
        <Alert>
          <InfoIcon />
          <AlertTitle>{t('editor.cantShow')}</AlertTitle>
          {/* Placeholder: Task 5 turns this into the link to the Advanced tab. */}
          <AlertDescription>{t('editor.cantShowAction')}</AlertDescription>
        </Alert>
      </EditorShell>
    )
  }
  return (
    <EditorShell title={title} caption={caption} aside={aside}>
      <SimpleEditor key={`${stub.id}:${meta.version}`} integration={integration} endpoint={endpoint} initial={form} mock={stub} />
    </EditorShell>
  )
}
