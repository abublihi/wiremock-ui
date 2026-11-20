import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowLeftRightIcon } from 'lucide-react'
import { useEndpoints, useIntegrations } from '@/ui/api/queries'
import { EditorShell } from '@/ui/components/editor/EditorShell'
import { EndpointInfo, EndpointPicker } from '@/ui/components/editor/EndpointPicker'
import { SimpleEditor } from '@/ui/components/editor/SimpleEditor'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'

export type NewMockSearch = { integration?: string; endpoint?: string }

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

export const Route = createFileRoute('/_app/mocks/new')({
  validateSearch: (raw: Record<string, unknown>): NewMockSearch => ({ integration: str(raw.integration), endpoint: str(raw.endpoint) }),
  component: NewMockRoute,
})

function NewMockRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const onSearchChange = useCallback((next: NewMockSearch) => void navigate({ search: next }), [navigate])
  return <NewMockPage search={search} onSearchChange={onSearchChange} />
}

/** New mock: pick a catalog endpoint (kept in the URL), then fill the Simple form for it. */
export function NewMockPage({ search, onSearchChange }: { search: NewMockSearch; onSearchChange: (next: NewMockSearch) => void }) {
  const t = useT()
  const integrations = useIntegrations()
  const endpoints = useEndpoints(search.endpoint ? search.integration : undefined)
  const integration = integrations.data?.find((i) => i.key === search.integration)
  const endpoint = endpoints.data?.find((e) => e.key === search.endpoint)

  if (!search.integration || !search.endpoint) {
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.newCaption')}>
        <EndpointPicker onPick={(i, e) => onSearchChange({ integration: i, endpoint: e })} />
      </EditorShell>
    )
  }

  const change = (
    <Button variant="outline" size="sm" onClick={() => onSearchChange({})}>
      <ArrowLeftRightIcon data-icon="inline-start" />
      {t('editor.changeEndpoint')}
    </Button>
  )

  if (integrations.isPending || endpoints.isPending) {
    return (
      <EditorShell title={t('editor.newTitle')} caption="//">
        <Skeleton className="h-96 w-full" />
      </EditorShell>
    )
  }
  if (!integration || !endpoint) {
    const error = integrations.error ?? endpoints.error
    return (
      <EditorShell title={t('editor.newTitle')} caption="//" actions={change}>
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{error ? t('editor.pickLoadFailed') : t('editor.endpointMissing', { ref: `${search.integration}/${search.endpoint}` })}</AlertTitle>
          {error && <AlertDescription>{error.message}</AlertDescription>}
        </Alert>
      </EditorShell>
    )
  }

  return (
    <EditorShell
      title={t('editor.newTitle')}
      caption={`// ${t('editor.endpointRef', { integration: integration.name, endpoint: endpoint.name })}`}
      actions={change}
      aside={<EndpointInfo integration={integration} endpoint={endpoint} />}
    >
      <p className="sr-only">{t('editor.endpointRef', { integration: integration.name, endpoint: endpoint.name })}</p>
      <SimpleEditor key={`${integration.key}/${endpoint.key}`} integration={integration} endpoint={endpoint} />
    </EditorShell>
  )
}
