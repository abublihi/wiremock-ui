import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowLeftIcon, ListTreeIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint } from '@/server/catalog/types'
import { forgetIntegration, useDeleteIntegration, useEndpoints, useIntegrations } from '@/ui/api/queries'
import { DeleteConfirm } from '@/ui/components/catalog/DeleteConfirm'
import { EndpointForm } from '@/ui/components/catalog/EndpointForm'
import { EndpointList } from '@/ui/components/catalog/EndpointList'
import { IntegrationForm } from '@/ui/components/catalog/IntegrationForm'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'

export const Route = createFileRoute('/_app/catalog/$key')({ component: IntegrationRoute })

function IntegrationRoute() {
  const { key } = Route.useParams()
  return <IntegrationPage integrationKey={key} />
}

export function IntegrationPage({ integrationKey }: { integrationKey: string }) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const integrations = useIntegrations()
  const endpoints = useEndpoints(integrationKey)
  const removeIntegration = useDeleteIntegration()
  const [editingIntegration, setEditingIntegration] = useState(false)
  // The endpoint form keeps its last content while the sheet animates closed.
  const [form, setForm] = useState<{ endpoint?: Endpoint }>({})
  const [formOpen, setFormOpen] = useState(false)
  const openForm = (endpoint?: Endpoint) => {
    setForm({ endpoint })
    setFormOpen(true)
  }

  const integration = integrations.data?.find((i) => i.key === integrationKey)
  const back = (
    <Button asChild variant="ghost" size="sm" className="w-fit">
      <Link to="/catalog">
        <ArrowLeftIcon data-icon="inline-start" className="rtl:rotate-180" />
        {t('catalog.back')}
      </Link>
    </Button>
  )

  if (integrations.isPending) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (integrations.isError || !integration) {
    return (
      <div className="fade-up flex flex-col gap-5">
        {back}
        <Alert variant={integrations.isError ? 'destructive' : 'default'}>
          <AlertCircleIcon />
          <AlertTitle>{integrations.isError ? t('catalog.loadFailed') : t('catalog.notFoundTitle')}</AlertTitle>
          <AlertDescription>{integrations.isError ? integrations.error.message : t('catalog.notFoundBody', { key: integrationKey })}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const count = endpoints.data?.length ?? 0
  const addEndpoint = (
    <Button onClick={() => openForm()}>
      <PlusIcon data-icon="inline-start" />
      {t('catalog.endpoints.add')}
    </Button>
  )

  return (
    <div className="fade-up flex flex-col gap-5">
      {back}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{integration.name}</h1>
          <p dir="ltr" className="font-mono text-xs text-muted-foreground">
            // {integration.key} · {integration.prefix}
          </p>
          {integration.description && <p className="mt-2 max-w-prose text-sm">{integration.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditingIntegration(true)}>
            <PencilIcon data-icon="inline-start" />
            {t('catalog.edit')}
          </Button>
          <DeleteConfirm
            trigger={
              <Button variant="outline" size="sm" className="hover:border-mismatch/50 hover:text-mismatch">
                <Trash2Icon data-icon="inline-start" />
                {t('catalog.delete')}
              </Button>
            }
            title={t('catalog.integration.deleteTitle', { name: integration.name })}
            body={t('catalog.integration.deleteBody')}
            failedTitle={t('catalog.integration.deleteFailed')}
            onConfirm={async () => {
              await removeIntegration.mutateAsync(integration.key)
              toast.success(t('catalog.integration.deleted', { name: integration.name }))
              await navigate({ to: '/catalog' })
              await forgetIntegration(queryClient, integration.key)
            }}
          />
        </div>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-wide uppercase">{t('catalog.endpoints')}</h2>
          <p className="text-xs text-muted-foreground">
            {endpoints.data ? t(count === 1 ? 'catalog.endpoints.captionOne' : 'catalog.endpoints.caption', { count }) : '//'}
          </p>
        </div>
        {count > 0 && addEndpoint}
      </div>

      {endpoints.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : endpoints.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('catalog.endpoints.loadFailed')}</AlertTitle>
          <AlertDescription>
            <p>{endpoints.error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void endpoints.refetch()}>
              {t('catalog.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : count === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListTreeIcon />
            </EmptyMedia>
            <EmptyTitle>{t('catalog.endpoints.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('catalog.endpoints.emptyBody', { name: integration.name })}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addEndpoint}</EmptyContent>
        </Empty>
      ) : (
        <EndpointList integration={integration} endpoints={endpoints.data} onEdit={openForm} />
      )}

      <IntegrationForm integration={integration} open={editingIntegration} onOpenChange={setEditingIntegration} />
      <EndpointForm integration={integration} endpoint={form?.endpoint} open={formOpen} onOpenChange={setFormOpen} />
    </div>
  )
}
