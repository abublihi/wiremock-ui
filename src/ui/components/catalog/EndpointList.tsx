import { Link } from '@tanstack/react-router'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { useDeleteEndpoint } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { useT } from '@/ui/i18n'
import { DeleteConfirm } from './DeleteConfirm'

/** The URL an endpoint answers on: the integration's prefix in front of its path. */
export const endpointUrl = (integration: Pick<Integration, 'prefix'>, endpoint: Pick<Endpoint, 'path'>) =>
  (integration.prefix === '/' ? '' : integration.prefix) + endpoint.path

/** The endpoints of one integration, one row each, with New mock / Edit / Delete. */
export function EndpointList({
  integration,
  endpoints,
  onEdit,
}: {
  integration: Integration
  endpoints: Endpoint[]
  onEdit: (endpoint: Endpoint) => void
}) {
  const t = useT()
  const remove = useDeleteEndpoint()
  return (
    <ul className="stagger-children flex flex-col gap-3">
      {endpoints.map((endpoint) => {
        const url = endpointUrl(integration, endpoint)
        return (
          <li key={endpoint.key} className="glow-border flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium">{endpoint.name}</h3>
                <p dir="ltr" className="font-mono text-[11px] text-muted-foreground">
                  {endpoint.key}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm" aria-label={t('catalog.endpoints.newMockFor', { name: endpoint.name })}>
                  <Link to="/mocks/new" search={{ integration: integration.key, endpoint: endpoint.key }}>
                    <PlusIcon data-icon="inline-start" />
                    {t('catalog.endpoints.newMock')}
                  </Link>
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('catalog.endpoints.editFor', { name: endpoint.name })} onClick={() => onEdit(endpoint)}>
                  <PencilIcon />
                </Button>
                <DeleteConfirm
                  trigger={
                    <Button variant="ghost" size="icon-sm" className="hover:text-mismatch" aria-label={t('catalog.endpoints.deleteFor', { name: endpoint.name })}>
                      <Trash2Icon />
                    </Button>
                  }
                  title={t('catalog.endpoints.deleteTitle', { name: endpoint.name })}
                  body={t('catalog.endpoints.deleteBody')}
                  onConfirm={async () => {
                    await remove.mutateAsync({ integration: integration.key, key: endpoint.key })
                    toast.success(t('catalog.deleted', { name: endpoint.name }))
                  }}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MethodBadge method={endpoint.method} />
              <span dir="ltr" className="min-w-0 break-all font-mono text-xs">
                {url}
              </span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {t(`catalog.endpoint.pathType.${endpoint.pathType}`)}
              </Badge>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">{t('catalog.endpoints.lookup')}</dt>
              <dd dir="ltr" className="font-mono">
                {endpoint.lookup ? `${endpoint.lookup.location} · ${endpoint.lookup.expression}` : <span className="text-muted-foreground">{t('catalog.endpoints.noLookup')}</span>}
              </dd>
              <dt className="text-muted-foreground">{t('catalog.endpoints.statuses')}</dt>
              <dd className="flex flex-wrap items-center gap-1">
                {endpoint.allowedStatuses.length > 0 ? (
                  endpoint.allowedStatuses.map((s) => <StatusBadge key={s} status={s} />)
                ) : (
                  <span className="text-muted-foreground">{t('catalog.endpoints.anyStatus')}</span>
                )}
              </dd>
            </dl>
          </li>
        )
      })}
    </ul>
  )
}
