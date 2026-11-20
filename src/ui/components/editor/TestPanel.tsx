import { useId, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircleIcon, AlertTriangleIcon, CheckIcon, PlusIcon, SendIcon, TerminalIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { TestRequestInput, TestRequestResult } from '@/server/wiremock/relay'
import { useMock, useSendTestRequest } from '@/ui/api/queries'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Body, HeaderTable, Part, prettyBody } from '@/ui/components/requests/HttpParts'
import { NoMatchStamp } from '@/ui/components/requests/NoMatchStamp'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet'
import { Spinner } from '@/ui/components/ui/spinner'
import { Textarea } from '@/ui/components/ui/textarea'
import { useWiremockPublicUrl } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { copyText } from '@/ui/lib/clipboard'
import { curlFromDraft } from '@/ui/lib/curl'
import type { Pair, RequestDraft } from '@/ui/lib/test-request'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
const NO_BODY = new Set(['GET', 'HEAD'])

type Row = Pair & { id: number }
let nextRow = 0
const toRows = (pairs: Pair[]): Row[] => pairs.map((p) => ({ ...p, id: nextRow++ }))
const toPairs = (rows: Row[]): Pair[] => rows.filter((r) => r.name.trim() !== '').map(({ name, value }) => ({ name: name.trim(), value }))

/** The relay's body: repeated query names become lists, repeated headers are joined with ", ". */
export function toRelayInput(draft: RequestDraft): TestRequestInput {
  const query: Record<string, string | string[]> = {}
  for (const { name, value } of draft.query) {
    const seen = query[name]
    query[name] = seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value]
  }
  const headers: Record<string, string> = {}
  for (const { name, value } of draft.headers) {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase()) ?? name
    headers[key] = headers[key] === undefined ? value : `${headers[key]}, ${value}`
  }
  const method = (METHODS as readonly string[]).includes(draft.method) ? draft.method : 'GET'
  return {
    method: method as TestRequestInput['method'],
    path: draft.path,
    ...(Object.keys(query).length > 0 ? { query } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(draft.body !== '' && !NO_BODY.has(method) ? { body: draft.body } : {}),
  }
}

/** Copies a curl command and says so; `command` may be undefined while the WireMock URL is still loading. */
export async function copyCurl(command: string | undefined, t: ReturnType<typeof useT>) {
  if (command === undefined) {
    toast.error(t('curl.copyFailed'), { description: t('curl.noPublicUrl') })
    return
  }
  try {
    await copyText(command)
    toast.success(t('curl.copied'))
  } catch (error) {
    toast.error(t('curl.copyFailed'), { description: error instanceof Error ? error.message : undefined })
  }
}

const TITLES = { mock: 'test.titleMock', resend: 'test.titleResend', endpoint: 'test.titleEndpoint' } as const
const CAPTIONS = { mock: 'test.captionMock', resend: 'test.captionResend', endpoint: 'test.captionEndpoint' } as const

export type TestPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The request the panel starts with (read when it opens). */
  initial: RequestDraft
  /** The mock under test: its id tells "matched this mock" from "matched another one". */
  mockId?: string
  /** The initial path is a regex the user must replace. */
  pathIsPattern?: boolean
  /** mock: test a saved mock; resend: a logged request; endpoint: "Try it" on a catalog endpoint. */
  variant?: 'mock' | 'resend' | 'endpoint'
}

/**
 * "Test this mock": an editable request sent to WireMock through the server relay, and WireMock's answer —
 * status, time, which mock matched (or the No match stamp), headers and body. Also Resend for a logged request.
 */
export function TestPanel({ open, onOpenChange, ...rest }: TestPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="glass-panel flex flex-col gap-0 data-[side=end]:w-full data-[side=end]:sm:max-w-2xl">
        {open && <PanelBody {...rest} />}
      </SheetContent>
    </Sheet>
  )
}

function PanelBody({ initial, mockId, pathIsPattern = false, variant = 'mock' }: Omit<TestPanelProps, 'open' | 'onOpenChange'>) {
  const t = useT()
  const id = useId()
  const publicUrl = useWiremockPublicUrl()
  const [method, setMethod] = useState(initial.method)
  const [path, setPath] = useState(initial.path)
  const [query, setQuery] = useState(() => toRows(initial.query))
  const [headers, setHeaders] = useState(() => toRows(initial.headers))
  const [body, setBody] = useState(initial.body)
  const send = useSendTestRequest()

  const draft: RequestDraft = { method, path, query: toPairs(query), headers: toPairs(headers), body }
  const bodyless = NO_BODY.has(method)
  const stillPattern = pathIsPattern && path === initial.path
  const pathHintId = `${id}-path-hint`
  const methods = (METHODS as readonly string[]).includes(method) ? METHODS : [method, ...METHODS]

  const onSend = () => send.mutate(toRelayInput(draft))
  const curl = () => curlFromDraft(bodyless ? { ...draft, body: '' } : draft, publicUrl ?? '')

  return (
    <>
      <SheetHeader className="gap-1 border-b border-line pe-12">
        <p className="text-[9.5px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">— {t('test.open')}</p>
        <SheetTitle>{t(TITLES[variant])}</SheetTitle>
        <SheetDescription className="text-xs">{t(CAPTIONS[variant])}</SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4">
        <form
          id={`${id}-form`}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            onSend()
          }}
        >
          <div className="flex gap-2">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger aria-label={t('test.method')} className="w-28 shrink-0 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {methods.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono text-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t('test.path')}
              aria-describedby={pathHintId}
              placeholder="/blog/posts/42"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
              dir="ltr"
              aria-invalid={stillPattern || undefined}
              className="min-w-0 flex-1 font-mono text-xs"
            />
          </div>
          <p id={pathHintId} className="text-[11px] text-muted-foreground">
            {t('test.pathHint')}
          </p>
          {stillPattern && (
            <p role="note" className="flex items-start gap-2 text-[11px] text-hazard-fg">
              <AlertTriangleIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              {t('test.pathPattern')}
            </p>
          )}

          <PairEditor title={t('test.query')} rows={query} onChange={setQuery} addLabel={t('test.addQuery')} />
          <PairEditor title={t('test.headers')} rows={headers} onChange={setHeaders} addLabel={t('test.addHeader')} />

          <Part title={t('test.body')}>
            <Textarea
              aria-label={t('test.body')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={bodyless}
              spellCheck={false}
              dir="ltr"
              rows={Math.min(12, Math.max(4, body.split('\n').length))}
              className="font-mono text-xs leading-relaxed"
            />
            {bodyless && body !== '' && <p className="text-[11px] text-muted-foreground">{t('test.bodyNotSent')}</p>}
          </Part>
        </form>

        <section aria-live="polite" aria-busy={send.isPending} className="flex flex-col gap-3">
          {send.isError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>{t('test.failed')}</AlertTitle>
              <AlertDescription>{send.error.message}</AlertDescription>
            </Alert>
          ) : send.data ? (
            <Result result={send.data} mockId={mockId} />
          ) : (
            <p className="text-[11px] text-muted-foreground">{t('test.empty')}</p>
          )}
        </section>
      </div>

      <SheetFooter className="border-t border-line sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => void copyCurl(publicUrl === undefined ? undefined : curl(), t)}>
          <TerminalIcon data-icon="inline-start" />
          {t('curl.copy')}
        </Button>
        <Button type="submit" form={`${id}-form`} disabled={send.isPending || path.trim() === ''}>
          {send.isPending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          {send.isPending ? t('test.sending') : t('test.send')}
        </Button>
      </SheetFooter>
    </>
  )
}

function PairEditor({ title, rows, onChange, addLabel }: { title: string; rows: Row[]; onChange: (rows: Row[]) => void; addLabel: string }) {
  const t = useT()
  const update = (id: number, patch: Partial<Pair>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <Part title={title}>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-1.5">
              <Input
                aria-label={`${title}: ${t('test.name')}`}
                placeholder={t('test.name')}
                value={row.name}
                onChange={(e) => update(row.id, { name: e.target.value })}
                spellCheck={false}
                dir="ltr"
                className="h-8 w-2/5 font-mono text-xs"
              />
              <Input
                aria-label={`${title}: ${row.name || t('test.value')}`}
                placeholder={t('test.value')}
                value={row.value}
                onChange={(e) => update(row.id, { value: e.target.value })}
                spellCheck={false}
                dir="ltr"
                className="h-8 min-w-0 flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={row.name ? t('test.remove', { name: row.name }) : t('test.removeRow')}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="w-fit text-muted-foreground hover:text-signal-fg"
        onClick={() => onChange([...rows, { name: '', value: '', id: nextRow++ }])}
      >
        <PlusIcon data-icon="inline-start" />
        {addLabel}
      </Button>
    </Part>
  )
}

const formatSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

function Result({ result, mockId }: { result: TestRequestResult; mockId?: string }) {
  const t = useT()
  // base64 holds 3 bytes in every 4 characters (less the padding).
  const binarySize = result.bodyIsBase64 ? Math.floor((result.body.length * 3) / 4) - (result.body.match(/=+$/)?.[0].length ?? 0) : 0
  return (
    <Part title={t('test.response')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <StatusBadge status={result.status} />
        <span className="font-mono text-muted-foreground tabular-nums">{t('test.duration', { ms: result.durationMs })}</span>
        <MatchLine matchedStubId={result.matchedStubId} mockId={mockId} />
      </div>
      <HeaderTable headers={result.headers} />
      {result.bodyIsBase64 ? (
        <p className="text-[11px] text-muted-foreground">{t('test.base64', { size: formatSize(binarySize) })}</p>
      ) : (
        <Body text={prettyBody(result.body)} />
      )}
      {result.bodyTruncated && <p className="text-[11px] text-hazard-fg">{t('test.truncated')}</p>}
    </Part>
  )
}

function MatchLine({ matchedStubId, mockId }: { matchedStubId: string | null; mockId?: string }) {
  const t = useT()
  const other = matchedStubId !== null && matchedStubId !== mockId
  const matched = useMock(matchedStubId ?? '', { enabled: other })
  if (matchedStubId === null) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <NoMatchStamp />
        <span className="sr-only">{t('test.noMatchHint')}</span>
        <Link to="/requests" search={{ matched: 'false' }} className="text-signal-fg hover:underline">
          {t('test.seeUnmatched')}
        </Link>
      </span>
    )
  }
  if (!other) {
    return (
      <span className="flex items-center gap-1.5 font-medium text-signal-fg">
        <CheckIcon aria-hidden className="size-3.5" />
        {t('test.matchedThis')}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-match" />
      <span className="text-muted-foreground">{t(mockId ? 'test.matchedOther' : 'test.matchedBy')}</span>
      <Link to="/mocks/$id" params={{ id: matchedStubId }} className="truncate font-medium text-foreground hover:text-signal-fg hover:underline">
        {matched.data?.name || matchedStubId}
      </Link>
    </span>
  )
}
