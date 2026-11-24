import { useCallback, useEffect } from 'react'
import { Link, createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertCircleIcon, DatabaseIcon, InboxIcon } from 'lucide-react'
import { useIntegrations, useMockPage, useTags } from '@/ui/api/queries'
import { GettingStartedChecklist } from '@/ui/components/guide/GettingStarted'
import { WithTerm } from '@/ui/components/guide/Term'
import { ExportMenu } from '@/ui/components/mocks/ExportMenu'
import { NewMockButton, ResetMineButton } from '@/ui/components/mocks/MockActions'
import { DEFAULT_OWNER, MockFilters, type MocksSearch } from '@/ui/components/mocks/MockFilters'
import { MockPager, usePageSize } from '@/ui/components/mocks/MockPager'
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

// Page 1 is the default and stays out of the URL.
const pageOf = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 1 ? n : undefined
}

export const Route = createFileRoute('/_app/mocks/')({
  validateSearch: (raw: Record<string, unknown>): MocksSearch => ({
    owner: str(raw.owner),
    integration: str(raw.integration),
    status: str(raw.status),
    q: str(raw.q),
    scenarios: raw.scenarios === 'only' ? 'only' : undefined,
    tag: str(raw.tag),
    page: pageOf(raw.page),
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
  // Paging pushes a history entry, so Back returns to the previous page; filters replace.
  const onPageChange = useCallback(
    (page: number) => void navigate({ to: '.', search: ((prev: MocksSearch) => ({ ...prev, page: page > 1 ? page : undefined })) as never }),
    [navigate],
  )
  return <MocksPage search={search} onSearchChange={onSearchChange} onPageChange={onPageChange} />
}

/**
 * The mock list, one page at a time. `search` is the URL's filter state; `onSearchChange` merges a patch into it
 * (undefined clears a key); `onPageChange` moves to another page (default: through `onSearchChange`).
 */
export function MocksPage({
  search,
  onSearchChange,
  onPageChange,
}: {
  search: MocksSearch
  onSearchChange: (next: MocksSearch) => void
  onPageChange?: (page: number) => void
}) {
  const t = useT()
  const wiremockOnly = useWireMockOnly()
  // WireMock-only mode lists everything WireMock serves (no owner filter, no "Reset my mocks").
  const owner = wiremockOnly ? 'all' : (search.owner ?? DEFAULT_OWNER)
  // 'all' is the UI's word for no owner filter; the API treats an owner value literally.
  const page = search.page ?? 1
  const [size, setSize] = usePageSize()
  const mocks = useMockPage(
    {
      owner: owner === 'all' ? undefined : owner,
      integration: search.integration,
      status: search.status,
      q: search.q,
      scenario: search.scenarios === 'only' ? '*' : undefined,
      tag: search.tag,
    },
    { limit: size, offset: (page - 1) * size },
  )
  const goTo = (next: number) => (onPageChange ? onPageChange(next) : onSearchChange({ page: next > 1 ? next : undefined }))
  // A filter change starts again at page 1.
  const onFilterChange = useCallback((next: MocksSearch) => onSearchChange({ ...next, page: undefined }), [onSearchChange])
  const integrations = useIntegrations()
  const tags = useTags()
  // Nothing to build mocks from yet: the first step is the catalog, not New mock.
  const noCatalog = integrations.data?.length === 0
  const filtered = Boolean(search.integration || search.status || search.q || search.scenarios || search.tag || (!wiremockOnly && owner !== 'me' && owner !== 'all'))

  const count = mocks.data?.totalMocks ?? 0
  const baseline = mocks.data?.baseline ?? 0
  const mine = !wiremockOnly && owner === 'me'
  // My mocks is empty: say how many shared mocks there are, so a newcomer knows where they went.
  const everyone = useMockPage({}, { limit: 1, offset: 0 }, { enabled: mine && mocks.data !== undefined && count === 0 })
  const shared = mine && count === 0 ? (everyone.data?.totalMocks ?? 0) : 0
  const clearFilters = () =>
    onSearchChange({ owner: undefined, integration: undefined, status: undefined, q: undefined, scenarios: undefined, tag: undefined, page: undefined })
  // Past the last page (mocks deleted, an old link): go to the last page that has rows.
  const lastPage = mocks.data ? Math.max(1, Math.ceil(mocks.data.total / size)) : 1
  const pastEnd = Boolean(mocks.data && !mocks.isPlaceholderData && page > lastPage)
  useEffect(() => {
    if (pastEnd) onSearchChange({ page: lastPage > 1 ? lastPage : undefined })
  }, [pastEnd, lastPage, onSearchChange])

  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('mocks.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {!mocks.data ? '//' : mine ? t(count === 1 ? 'mocks.captionMineOne' : 'mocks.captionMine', { count }) : <WithTerm text={t(count === 1 ? 'mocks.captionOne' : 'mocks.caption', { count, baseline })} word="baseline" name="baseline" />}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu scope={scopeFromFilter({ owner, integration: search.integration, wiremockOnly })} />
          {/* Nothing of yours to reset (known on My mocks only). */}
          {!wiremockOnly && <ResetMineButton disabled={mine && mocks.data !== undefined && count === 0} />}
          <NewMockButton />
        </div>
      </header>

      <GettingStartedChecklist />

      <MockFilters search={search} integrations={integrations.data ?? []} tags={tags.data} onChange={onFilterChange} />

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
      ) : count === 0 && !filtered && noCatalog ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseIcon />
            </EmptyMedia>
            <EmptyTitle>{t('mocks.startTitle')}</EmptyTitle>
            <EmptyDescription>{t('mocks.startBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button asChild>
              <Link to="/integrations">{t('mocks.openCatalog')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/mocks/new" search={{ mode: 'url' }}>
                {t('editor.mockUrl')}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : count === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>{t(filtered ? 'mocks.noMatchTitle' : mine ? 'mocks.emptyMineTitle' : 'mocks.emptyTitle')}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? t('mocks.noMatchBody')
                : shared > 0
                  ? t(shared === 1 ? 'mocks.emptyMineSharedOne' : 'mocks.emptyMineShared', { count: shared })
                  : t('mocks.emptyBody')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            {!filtered && shared > 0 && (
              <Button variant="outline" onClick={() => onFilterChange({ owner: 'all' })}>
                {t('mocks.ownerAll')}
              </Button>
            )}
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
        <div className="flex flex-col gap-3">
          {/* While a search or filter is set, scenario groups start open so a hit inside one is visible. */}
          <MockTable mocks={mocks.data.items} expanded={Boolean(search.q || search.status || search.integration || search.tag)} />
          <MockPager
            page={page}
            size={size}
            total={mocks.data.total}
            totalMocks={mocks.data.totalMocks}
            loading={mocks.isPlaceholderData}
            onPage={goTo}
            onSize={(next) => {
              setSize(next)
              onSearchChange({ page: undefined })
            }}
          />
        </div>
      )}
    </div>
  )
}
