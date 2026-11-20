import { useId, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircleIcon, PlusIcon } from 'lucide-react'
import type { LoggedEvent } from '@/server/wiremock/types'
import { useRequest } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { parseJsonBody } from '@/ui/lib/prefill'
import { NearMissPanel } from './NearMissPanel'
import { NoMatchStamp } from './NoMatchStamp'
import { LoggedTime } from './RequestTable'

type Headers = Record<string, unknown> | undefined

/** Header values as WireMock logs them: a string, a list, or `{ values: [...] }`. */
function headerValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(headerValue).join(', ')
  if (value && typeof value === 'object' && 'values' in value) return headerValue((value as { values: unknown }).values)
  return String(value ?? '')
}

/** The body as text, JSON pretty-printed. */
function prettyBody(body: string | undefined): string | null {
  if (!body) return null
  const json = parseJsonBody(body)
  return json ? JSON.stringify(json, null, 2) : body
}

/** The request detail drawer: the near-miss explanation (unmatched) or the matching mock, then request, response and timing. */
export function RequestDrawer({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="glass-panel flex flex-col gap-0 data-[side=end]:w-full data-[side=end]:sm:max-w-2xl">{id && <DrawerBody id={id} />}</SheetContent>
    </Sheet>
  )
}

function DrawerBody({ id }: { id: string }) {
  const t = useT()
  const event = useRequest(id)

  if (event.isPending) {
    return (
      <>
        <SheetHeader className="pe-12">
          <SheetTitle>{t('request.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('common.loading')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </>
    )
  }
  if (event.isError) {
    return (
      <>
        <SheetHeader className="pe-12">
          <SheetTitle>{t('request.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('request.loadFailed')}</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{t('request.loadFailed')}</AlertTitle>
            <AlertDescription>{event.error.message}</AlertDescription>
          </Alert>
        </div>
      </>
    )
  }

  const e = event.data
  const status = e.response?.status ?? e.responseDefinition?.status
  return (
    <>
      <SheetHeader className="gap-2 border-b border-line pe-12">
        <p className="text-[9.5px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">— {t('request.title')}</p>
        <SheetTitle className="flex min-w-0 items-center gap-2 text-sm">
          <MethodBadge method={e.request.method} />
          <span dir="ltr" className="min-w-0 font-mono font-medium wrap-anywhere">
            {e.request.url}
          </span>
        </SheetTitle>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            {typeof status === 'number' && <StatusBadge status={status} />}
            {e.wasMatched ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-match" />
                <span className="text-muted-foreground">{t('request.matchedBy')}</span>
                {e.stubMapping?.id ? (
                  <Link to="/mocks/$id" params={{ id: e.stubMapping.id }} className="truncate font-medium text-foreground hover:text-signal-fg hover:underline">
                    {e.stubMapping.name || t('requests.unnamedMock')}
                  </Link>
                ) : (
                  <span>{t('requests.unnamedMock')}</span>
                )}
              </span>
            ) : (
              <NoMatchStamp size="lg" className="my-1 ms-1" />
            )}
          </div>
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-4 py-4">
        {!e.wasMatched && <NearMissPanel requestId={id} />}
        <Part title={t('request.request')}>
          <HeaderTable headers={e.request.headers} />
          <Body text={prettyBody(e.request.body)} />
        </Part>
        <Part title={t('request.response')}>
          {typeof status === 'number' && (
            <div className="flex items-center gap-2 text-xs">
              <StatusBadge status={status} />
            </div>
          )}
          <HeaderTable headers={e.response?.headers as Headers} />
          <Body text={prettyBody(e.response?.body)} />
        </Part>
        <Timing event={e} />
      </div>

      <SheetFooter className="border-t border-line sm:flex-row sm:justify-end">
        <Button asChild>
          <Link to="/mocks/new" search={{ from: id }}>
            <PlusIcon data-icon="inline-start" />
            {t('request.createMock')}
          </Link>
        </Button>
      </SheetFooter>
    </>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        <span aria-hidden>— </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

function HeaderTable({ headers }: { headers: Headers }) {
  const t = useT()
  const entries = Object.entries(headers ?? {})
  if (entries.length === 0) return <p className="text-[11px] text-muted-foreground">{t('request.noHeaders')}</p>
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <table className="w-full table-fixed text-xs">
        <caption className="sr-only">{t('request.headers')}</caption>
        <colgroup>
          <col className="w-2/5" />
          <col />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">{t('request.header')}</th>
            <th scope="col">{t('request.value')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name} className="border-t border-line first:border-t-0">
              <th scope="row" dir="ltr" className="bg-surface-2/50 px-2.5 py-1.5 text-start align-top font-mono font-normal break-all text-muted-foreground">
                {name}
              </th>
              <td dir="ltr" className="px-2.5 py-1.5 font-mono break-all">
                {headerValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Body({ text }: { text: string | null }) {
  const t = useT()
  if (text === null) return <p className="text-[11px] text-muted-foreground">{t('request.noBody')}</p>
  return (
    <pre dir="ltr" aria-label={t('request.body')} className="max-h-80 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
      {text}
    </pre>
  )
}

function Timing({ event }: { event: LoggedEvent }) {
  const t = useT()
  const total = event.timing?.totalTime
  const logged = event.request.loggedDateString ?? (typeof event.request.loggedDate === 'number' ? new Date(event.request.loggedDate).toISOString() : undefined)
  return (
    <Part title={t('request.timing')}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
        {logged && (
          <>
            <dt className="text-muted-foreground">{t('request.loggedAt')}</dt>
            <dd>
              <LoggedTime iso={logged} />
            </dd>
          </>
        )}
        {typeof total === 'number' && (
          <>
            <dt className="text-muted-foreground">{t('request.total')}</dt>
            <dd className="font-mono tabular-nums">{t('requests.ms', { ms: total })}</dd>
          </>
        )}
      </dl>
    </Part>
  )
}
