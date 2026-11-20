import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { useDeleteEndpoint } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { TestPanel } from '@/ui/components/editor/TestPanel'
import { useT } from '@/ui/i18n'
import { draftFromEndpoint } from '@/ui/lib/test-request'
import { DeleteConfirm } from './DeleteConfirm'

/** The URL an endpoint answers on: the integration's prefix in front of its path. */
export const endpointUrl = (integration: Pick<Integration, 'prefix'>, endpoint: Pick<Endpoint, 'path'>) =>
  (integration.prefix === '/' ? '' : integration.prefix) + endpoint.path

/** Endpoint cards rendered at first and per "Show more": a thousand cards with their buttons take a second to render. */
export const ENDPOINTS_PER_STEP = 50

/** The endpoints of one integration, one row each, with New mock / Try it / Edit / Delete; 50 at a time. */
export function EndpointList({ integration, endpoints }: { integration: Integration; endpoints: Endpoint[] }) {
  const t = useT()
  const remove = useDeleteEndpoint()
  // The panel keeps the last endpoint while it animates closed.
  const [trying, setTrying] = useState<Endpoint | null>(null)
  const [tryOpen, setTryOpen] = useState(false)
  const tried = trying ? draftFromEndpoint(integration, trying) : null
  const [shown, setShown] = useState(ENDPOINTS_PER_STEP)
  const left = endpoints.length - shown
  return (
    <>
      <ul className="stagger-children flex flex-col gap-3">
        {endpoints.slice(0, shown).map((endpoint) => {
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
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t('catalog.endpoints.tryFor', { name: endpoint.name })}
                    onClick={() => {
                      setTrying(endpoint)
                      setTryOpen(true)
                    }}
                  >
                    <PlayIcon data-icon="inline-start" />
                    {t('catalog.endpoints.try')}
                  </Button>
                  <Button asChild variant="ghost" size="icon-sm" aria-label={t('catalog.endpoints.editFor', { name: endpoint.name })}>
                    <Link to="/catalog/$key/endpoints/$endpoint/edit" params={{ key: integration.key, endpoint: endpoint.key }}>
                      <PencilIcon />
                    </Link>
                  </Button>
                  <DeleteConfirm
                    trigger={
                      <Button variant="ghost" size="icon-sm" className="hover:text-mismatch" aria-label={t('catalog.endpoints.deleteFor', { name: endpoint.name })}>
                        <Trash2Icon />
                      </Button>
                    }
                    title={t('catalog.endpoints.deleteTitle', { name: endpoint.name })}
                    body={t('catalog.endpoints.deleteBody')}
                    failedTitle={t('catalog.endpoint.deleteFailed')}
                    onConfirm={async () => {
                      await remove.mutateAsync({ integration: integration.key, key: endpoint.key })
                      toast.success(t('catalog.endpoint.deleted', { name: endpoint.name }))
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
      {left > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>{t('catalog.endpoints.showing', { shown: shown.toLocaleString('en'), total: endpoints.length.toLocaleString('en') })}</span>
          <Button variant="outline" size="sm" onClick={() => setShown((n) => n + ENDPOINTS_PER_STEP)}>
            {t('catalog.endpoints.showMore', { count: Math.min(left, ENDPOINTS_PER_STEP) })}
          </Button>
        </div>
      )}
      {tried && (
        <TestPanel open={tryOpen} onOpenChange={setTryOpen} initial={tried.draft} pathIsPattern={tried.pathIsPattern} variant="endpoint" />
      )}
    </>
  )
}
