import { useCallback } from 'react'
import { Link, createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertCircleIcon, DatabaseIcon, InboxIcon } from 'lucide-react'
import { useIntegrations, useMocks } from '@/ui/api/queries'
import { ExportMenu } from '@/ui/components/mocks/ExportMenu'
import { NewMockButton, ResetMineButton } from '@/ui/components/mocks/MockActions'
import { MockFilters, type MocksSearch } from '@/ui/components/mocks/MockFilters'
import { MockTable, MockTableSkeleton } from '@/ui/components/mocks/MockTable'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { scopeFromFilter } from '@/ui/lib/export'

export type { MocksSearch }

// The router JSON-parses search values, so `?status=404` arrives as a number: accept strings and numbers.
const str = (v: unknown) => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return typeof v === 'string' && v !== '' ? v : undefined
}

export const Route = createFileRoute('/_app/mocks/')({
  validateSearch: (raw: Record<string, unknown>): MocksSearch => ({
    owner: str(raw.owner),
    integration: str(raw.integration),
    status: str(raw.status),
    q: str(raw.q),
    scenarios: raw.scenarios === 'only' ? 'only' : undefined,
  }),
  component: MocksRoute,
})

export function MocksRoute() {
  const search = useSearch({ strict: false }) as MocksSearch
  const navigate = useNavigate()
  const onSearchChange = useCallback(
    (next: MocksSearch) =>
      void navigate({ to: '.', search: ((prev: MocksSearch) => ({ ...prev, ...next })) as never, replace: true }),
    [navigate],
  )
  return <MocksPage search={search} onSearchChange={onSearchChange} />
}

/** The mock list. `search` is the URL's filter state; `onSearchChange` merges a patch into it (undefined clears a key). */
export function MocksPage({
  search,
  onSearchChange,
}: {
  search: MocksSearch
  onSearchChange: (next: MocksSearch) => void
}) {
  const t = useT()
  const wiremockOnly = useWireMockOnly()
  // WireMock-only mode lists everything WireMock serves (no owner filter, no "Reset my mocks").
  const owner = wiremockOnly ? 'all' : (search.owner ?? 'me')
  // 'all' is the UI's word for no owner filter; the API treats an owner value literally.
  const mocks = useMocks({
    owner: owner === 'all' ? undefined : owner,
    integration: search.integration,
    status: search.status,
    q: search.q,
    scenario: search.scenarios === 'only' ? '*' : undefined,
  })
  const integrations = useIntegrations()
  // Nothing to build mocks from yet: the first step is the catalog, not New mock.
  const noCatalog = integrations.data?.length === 0
  const filtered = Boolean(search.integration || search.status || search.q || search.scenarios || (!wiremockOnly && owner !== 'me'))

  const count = mocks.data?.length ?? 0
  const baseline = (mocks.data ?? []).filter((m) => (m.metadata?.wiremockUi?.owner ?? 'baseline') === 'baseline').length
  const clearFilters = () => onSearchChange({ owner: undefined, integration: undefined, status: undefined, q: undefined, scenarios: undefined })

  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('mocks.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {mocks.data ? t(count === 1 ? 'mocks.captionOne' : 'mocks.caption', { count, baseline }) : '//'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu scope={scopeFromFilter({ owner, integration: search.integration, wiremockOnly })} />
          {!wiremockOnly && <ResetMineButton />}
          <NewMockButton />
        </div>
      </header>

      <MockFilters search={search} integrations={integrations.data ?? []} onChange={onSearchChange} />

      {mocks.isError && mocks.data && (
        <p role="alert" className="flex items-center gap-2 text-xs text-mismatch">
          <AlertCircleIcon className="size-3.5" />
          {t('mocks.refreshFailed', { message: mocks.error.message })}
          <Button variant="ghost" size="xs" onClick={() => void mocks.refetch()}>
            {t('mocks.retry')}
          </Button>
        </p>
      )}

      {mocks.isPending ? (
        <MockTableSkeleton />
      ) : mocks.isError && !mocks.data ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('mocks.loadFailed')}</AlertTitle>
          <AlertDescription>
            <p>{mocks.error?.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void mocks.refetch()}>
              {t('mocks.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : mocks.data.length === 0 && !filtered && noCatalog ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseIcon />
            </EmptyMedia>
            <EmptyTitle>{t('mocks.startTitle')}</EmptyTitle>
            <EmptyDescription>{t('mocks.startBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/catalog">{t('mocks.openCatalog')}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : mocks.data.length === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>{t(filtered ? 'mocks.noMatchTitle' : 'mocks.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t(filtered ? 'mocks.noMatchBody' : 'mocks.emptyBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {filtered ? (
              <Button variant="outline" onClick={clearFilters}>
                {t('mocks.clearFilters')}
              </Button>
            ) : (
              <NewMockButton />
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <MockTable mocks={mocks.data} />
      )}
    </div>
  )
}
