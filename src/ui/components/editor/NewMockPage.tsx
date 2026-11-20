import { useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowLeftRightIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { useEndpoints, useIntegrations } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { EditorShell } from './EditorShell'
import { EndpointInfo, EndpointPicker } from './EndpointPicker'
import { MockEditor } from './MockEditor'

export type NewMockSearch = { integration?: string; endpoint?: string; mode?: 'json' }

/** New mock: pick a catalog endpoint (kept in the URL) and fill the Simple form, or start from blank JSON. */
export function NewMockPage({ search, onSearchChange }: { search: NewMockSearch; onSearchChange: (next: NewMockSearch) => void }) {
  const t = useT()
  const navigate = useNavigate()
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

  if (search.mode === 'json') {
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.blankCaption')} actions={change(t('editor.pickInstead'))}>
        <MockEditor simpleUnavailable={t('editor.noCatalog')} onSaved={open} />
      </EditorShell>
    )
  }

  if (!search.integration || !search.endpoint) {
    return (
      <EditorShell title={t('editor.newTitle')} caption={t('editor.newCaption')}>
        <EndpointPicker onPick={(i, e) => onSearchChange({ integration: i, endpoint: e })} onBlank={() => onSearchChange({ mode: 'json' })} />
      </EditorShell>
    )
  }

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
      <EditorShell title={t('editor.newTitle')} caption="//" actions={change(t('editor.changeEndpoint'))}>
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
    >
      <p className="sr-only">{ref}</p>
      {/* "Change endpoint" navigates, so the editor's unsaved-changes guard covers it. */}
      <MockEditor key={`${integration.key}/${endpoint.key}`} catalog={{ integration, endpoint }} onSaved={open} />
    </EditorShell>
  )
}
