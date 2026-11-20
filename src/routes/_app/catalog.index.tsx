import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, ChevronRightIcon, DatabaseIcon, InfoIcon, PlusIcon, XIcon } from 'lucide-react'
import { useEndpoints, useIntegrations } from '@/ui/api/queries'
import { HowItFits, ShowExplainerButton, useExplainer } from '@/ui/components/catalog/HowItFits'
import { IntegrationForm } from '@/ui/components/catalog/IntegrationForm'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'
import type { Integration } from '@/server/catalog/types'

export const Route = createFileRoute('/_app/catalog/')({ component: CatalogPage })

export function CatalogPage() {
  const t = useT()
  const integrations = useIntegrations()
  const [adding, setAdding] = useState(false)
  const explainer = useExplainer()
  const count = integrations.data?.length ?? 0
  const add = (
    <Button onClick={() => setAdding(true)}>
      <PlusIcon data-icon="inline-start" />
      {t('catalog.addIntegration')}
    </Button>
  )
  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('catalog.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {integrations.data ? t(count === 1 ? 'catalog.captionOne' : 'catalog.caption', { count }) : '//'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {explainer.shown === false && <ShowExplainerButton onClick={explainer.show} />}
          {add}
        </div>
      </header>

      <MemoryNotice />
      {explainer.shown && <HowItFits onHide={explainer.hide} />}

      {integrations.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : integrations.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('catalog.loadFailed')}</AlertTitle>
          <AlertDescription>
            <p>{integrations.error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void integrations.refetch()}>
              {t('catalog.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : count === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseIcon />
            </EmptyMedia>
            <EmptyTitle>{t('catalog.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('catalog.emptyBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{add}</EmptyContent>
        </Empty>
      ) : (
        <ul className="stagger-children grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {integrations.data.map((integration) => (
            <IntegrationCard key={integration.key} integration={integration} />
          ))}
        </ul>
      )}

      <IntegrationForm open={adding} onOpenChange={setAdding} />
    </div>
  )
}

const NOTICE_DISMISSED = 'wmui.catalogMemoryNotice.dismissed'

/** WireMock-only mode keeps the catalog in memory: say so once, until this browser dismisses it. */
function MemoryNotice() {
  const t = useT()
  const wiremockOnly = useWireMockOnly()
  // Read after mount (the server render cannot see this browser's storage); storage may be unavailable.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(NOTICE_DISMISSED) === '1') setDismissed(true)
    } catch {}
  }, [])
  if (!wiremockOnly || dismissed) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(NOTICE_DISMISSED, '1')
    } catch {}
  }
  return (
    <Alert role="status" className="border-hazard/50 bg-hazard/10 text-foreground">
      <InfoIcon className="text-hazard-fg" />
      <AlertDescription className="text-foreground">{t('catalog.memoryNotice')}</AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-sm" aria-label={t('catalog.memoryNoticeDismiss')} onClick={dismiss}>
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  )
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const t = useT()
  const endpoints = useEndpoints(integration.key)
  const n = endpoints.data?.length
  return (
    <li>
      <Link
        to="/catalog/$key"
        params={{ key: integration.key }}
        className="glow-border group flex h-full flex-col gap-2 rounded-md border border-line bg-surface p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-medium group-hover:text-signal-fg">{integration.name}</h2>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
        </div>
        <p dir="ltr" className="font-mono text-[11px] text-muted-foreground">
          {integration.key}
        </p>
        <p dir="ltr" className="truncate font-mono text-xs">
          {integration.prefix}
        </p>
        <p className="mt-auto pt-2 text-[11px] text-muted-foreground">
          {n === undefined ? t('catalog.endpointCountLoading') : t(n === 1 ? 'catalog.endpointCountOne' : 'catalog.endpointCount', { count: n })}
        </p>
      </Link>
    </li>
  )
}
