import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircleIcon, CheckIcon, CircleDashedIcon, PlusIcon, XIcon } from 'lucide-react'
import type { NearMissView } from '@/server/requests/journal'
import { useNearMisses } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/ui/components/ui/empty'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Term } from '@/ui/components/guide/Term'
import type { NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { useT } from '@/ui/i18n'
import { type DiffRow, type FieldState, diffRows, diffSummary } from '@/ui/lib/diff'
import { cn } from '@/ui/lib/utils'

const STATE_ICON: Record<FieldState, typeof CheckIcon> = { match: CheckIcon, mismatch: XIcon, unchecked: CircleDashedIcon }
const STATE_TEXT: Record<FieldState, string> = {
  match: 'text-match',
  mismatch: 'text-mismatch',
  unchecked: 'text-muted-foreground',
}
const STATE_LABEL = { match: 'near.match', mismatch: 'near.mismatch', unchecked: 'near.unchecked' } as const

/** Where "Create mock from this request" goes: the URL form prefilled from the request. */
export function createMockSearch(requestId: string): NewMockSearch {
  return { from: requestId }
}

/** Up to three closest mocks for an unmatched request, each explained field by field. */
export function NearMissPanel({ requestId }: { requestId: string }) {
  const t = useT()
  const headingId = useId()
  const misses = useNearMisses(requestId)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <header>
        <h3 id={headingId} className="text-[11px] font-semibold tracking-[0.18em] text-hazard-fg uppercase">
          <span aria-hidden>— </span>
          <Term name="near miss">{t('near.title')}</Term>
        </h3>
        <p className="text-xs text-muted-foreground">{t('near.caption')}</p>
      </header>
      {misses.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : misses.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('near.loadFailed')}</AlertTitle>
          <AlertDescription>{misses.error.message}</AlertDescription>
        </Alert>
      ) : misses.data.length === 0 ? (
        <Empty className="rounded-md border border-dashed border-line p-6">
          <EmptyHeader>
            <EmptyDescription>{t('near.empty')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild size="sm">
              <Link to="/mocks/new" search={{ from: requestId }}>
                <PlusIcon data-icon="inline-start" />
                {t('request.createMock')}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {misses.data.map((miss, i) => (
            <li key={miss.stub.id}>
              <NearMissCard miss={miss} rank={i + 1} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function NearMissCard({ miss, rank }: { miss: NearMissView; rank: number }) {
  const t = useT()
  const titleId = useId()
  const rows = diffRows(miss.diffs)
  const summary = diffSummary(rows)
  const name = miss.stub.name || t('requests.unnamedMock')
  // WireMock's distance: 0 is identical, 1 shares nothing. Shown as how close the mock came.
  const closeness = Math.round(Math.max(0, Math.min(1, 1 - miss.distance)) * 100)
  const nearness = miss.distance < 0.1 ? t('near.closest') : miss.distance < 0.3 ? t('near.close') : t('near.far')
  // The first difference in one plain sentence, above the table.
  const first = rows.find((r) => r.state === 'mismatch')
  // "Add a response for p-2": the closest mock answers by a value, and this request had another one.
  // A response of a mock with several responses missed: offer one for this request's values (when they could be read).
  const addValues = miss.group?.keyValues ?? null
  const addFor = addValues && addValues.some((v) => v !== null) ? addValues.filter((v) => v !== null).join(' · ') : null

  return (
    <article aria-labelledby={titleId} className="glow-border overflow-hidden rounded-md border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-3 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-lg leading-none font-bold text-muted-foreground tabular-nums">
            {t('near.rank', { rank })}
          </span>
          <div className="min-w-0">
            <h4 id={titleId} className="truncate text-sm font-semibold">
              <Link to="/mocks/$id" params={{ id: miss.stub.id }} className="hover:text-signal-fg hover:underline">
                {name}
              </Link>
            </h4>
            <dl className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {miss.stub.owner && (
                <div className="flex gap-1">
                  <dt>{t('near.owner')}</dt>
                  <dd className="text-foreground">{miss.stub.owner}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('text-xs font-medium', summary.mismatch > 0 ? 'text-mismatch' : 'text-muted-foreground')}>
            {summary.mismatch > 0 ? t('near.summary', { mismatch: summary.mismatch, total: summary.total }) : t('near.summaryNone')}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={`${t('near.distance')} ${miss.distance}`}>
            <span aria-hidden className="h-1 w-16 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-hazard" style={{ width: `${closeness}%` }} />
            </span>
            <span>{nearness}</span>
          </span>
        </div>
      </header>
      {(first || addFor !== null) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-3 py-2">
          {first && (
            <p className="min-w-0 text-xs">
              {first.actual === null
                ? t('near.oneLineMissing', { field: first.field, expected: first.expected })
                : t('near.oneLine', { field: first.field, expected: first.expected, actual: first.actual })}
            </p>
          )}
          {addFor !== null && (
            <Button asChild size="sm" variant="outline" className="ms-auto">
              <Link to="/mocks/$id" params={{ id: miss.stub.id }} search={{ add: addValues! }}>
                <PlusIcon data-icon="inline-start" />
                <span className="min-w-0 truncate">{t('near.addFor', { value: addFor })}</span>
              </Link>
            </Button>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">{t('near.noFields')}</p>
      ) : (
        <DiffTable rows={rows} />
      )}
    </article>
  )
}

function DiffTable({ rows }: { rows: DiffRow[] }) {
  const t = useT()
  const head = 'px-3 py-1.5 text-start text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase'
  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <colgroup>
        <col className="w-[34%]" />
        <col className="w-[33%]" />
        <col className="w-[33%]" />
      </colgroup>
      <thead className="bg-surface-2/60">
        <tr>
          <th scope="col" className={head}>
            {t('near.field')}
          </th>
          <th scope="col" className={head}>
            {t('near.expected')}
          </th>
          <th scope="col" className={head}>
            {t('near.actual')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const Icon = STATE_ICON[row.state]
          return (
            <tr
              key={`${row.field}-${i}`}
              data-state={row.state}
              className={cn(
                'border-t border-line align-top',
                row.state === 'mismatch' && 'bg-mismatch/[0.08] shadow-[inset_2px_0_0_var(--mismatch)]',
                row.state === 'unchecked' && 'text-muted-foreground',
              )}
            >
              <td className="px-3 py-2">
                <div className="flex items-start gap-2">
                  <Icon aria-hidden className={cn('mt-px size-3.5 shrink-0', STATE_TEXT[row.state])} strokeWidth={row.state === 'unchecked' ? 2 : 3} />
                  <div className="min-w-0">
                    <code dir="ltr" className="block font-mono font-medium wrap-anywhere">
                      {row.field}
                    </code>
                    <span className={cn('text-[11px] tracking-wide', STATE_TEXT[row.state])}>{t(STATE_LABEL[row.state])}</span>
                    {row.state === 'unchecked' && <p className="mt-0.5 text-[11px] leading-snug">{t('near.uncheckedHint')}</p>}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2">
                <code dir="ltr" className="line-clamp-6 font-mono wrap-anywhere whitespace-pre-wrap" title={row.expected}>
                  {row.expected}
                </code>
              </td>
              <td className="px-3 py-2">
                {row.actual === null ? (
                  <span className="text-muted-foreground italic">{t('near.missing')}</span>
                ) : (
                  <code
                    dir="ltr"
                    title={row.actual}
                    className={cn('line-clamp-6 font-mono wrap-anywhere whitespace-pre-wrap', row.state === 'mismatch' && 'text-mismatch')}
                  >
                    {row.actual}
                  </code>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
