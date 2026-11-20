import { useId, useMemo, useState, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertTriangleIcon, CheckIcon, FileWarningIcon, CopyIcon, GitBranchIcon, SearchXIcon, ShieldAlertIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { matchesPrefix } from '@/server/catalog/prefix'
import type { Recording, ReviewItem } from '@/server/recording/types'
import { endpointsQueryOptions, useAcceptRecording, useDiscardRecording, useIntegrations } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/ui/components/ui/alert-dialog'
import { Button } from '@/ui/components/ui/button'
import { Checkbox } from '@/ui/components/ui/checkbox'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Spinner } from '@/ui/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useSeedPrune, useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { NEW_ENDPOINT, acceptPayload, formatBytes, groupReviewItems, newEndpointFor, suggestLink, type ReviewGroup, type RowChoice } from '@/ui/lib/recording'
import { relativeTime } from '@/ui/lib/time'
import { cn } from '@/ui/lib/utils'

// Radix Select has no empty value: these stand for "none".
const NONE = '__none__'
const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'

/** The recorded answer as text, for checking it before accepting (bodies may hold real data). */
function bodyText(item: ReviewItem): string | null {
  const { response } = item.stub
  const headers = response.headers && typeof response.headers === 'object' ? Object.entries(response.headers as Record<string, unknown>) : []
  const head = headers.map(([name, value]) => `${name}: ${String(value)}`).join('\n')
  const body =
    response.jsonBody !== undefined
      ? JSON.stringify(response.jsonBody, null, 2)
      : typeof response.body === 'string'
        ? response.body
        : typeof response.base64Body === 'string'
          ? `// binary body (${formatBytes(item.bodySize)}), base64:\n${response.base64Body.slice(0, 400)}${response.base64Body.length > 400 ? '…' : ''}`
          : ''
  const text = [head, body].filter(Boolean).join('\n\n')
  return text === '' ? null : text
}

/** Rows a reviewer usually wants: not answered by "no mock", not already a mock. */
const preselected = (item: ReviewItem) => !item.unmatched && !item.duplicateOf && !item.tooLarge
/** A row whose body was too large to keep cannot be accepted. */
const acceptable = (item: ReviewItem) => !item.tooLarge

/**
 * One recording's review list: each recorded stub with its method, URL, status, body size and warnings,
 * a name and a catalog link to pick; Accept selected creates the mocks, Discard drops rows.
 */
export function ReviewList({ recording }: { recording: Recording }) {
  const t = useT()
  const ids = useId()
  const navigate = useNavigate()
  const integrations = useIntegrations()
  const allIntegrations = integrations.data ?? []
  // Only integrations whose prefix takes one of the recorded paths are worth loading endpoints for.
  const relevant = useMemo(
    () => allIntegrations.filter((i) => i.prefix !== '/' && recording.items.some((item) => matchesPrefix(item.url.split('?')[0], i.prefix))),
    [allIntegrations, recording.items],
  )
  const endpointQueries = useQueries({ queries: relevant.map((i) => endpointsQueryOptions(i.key)) })
  const endpoints: Record<string, Endpoint[] | undefined> = Object.fromEntries(relevant.map((i, n) => [i.key, endpointQueries[n]?.data]))

  const [selected, setSelected] = useState<Set<string>>(() => new Set(recording.items.filter(preselected).map((i) => i.id)))
  const [choices, setChoices] = useState<Record<string, RowChoice>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [chosenOwner, setOwner] = useState<'me' | 'baseline'>('me')
  // SEED_PRUNE deletes baseline mocks that are not in the seed on the next restart: the server refuses them, so the option is off.
  const seedPrune = useSeedPrune()
  const owner = seedPrune ? 'me' : chosenOwner
  // Rows kept as plain mocks ("Keep only the first answer"): accepted without their scenario fields.
  const [plain, setPlain] = useState<ReadonlySet<string>>(() => new Set())
  const accept = useAcceptRecording()
  const discard = useDiscardRecording()
  const busy = accept.isPending || discard.isPending

  const items = recording.items
  const groups = useMemo(() => groupReviewItems(items), [items])
  const wiremockOnly = useWireMockOnly()
  const choiceOf = (item: ReviewItem): RowChoice => choices[item.id] ?? { name: '', ...suggestLink(item, allIntegrations, endpoints) }
  const setChoice = (item: ReviewItem, patch: Partial<RowChoice>) => setChoices((prev) => ({ ...prev, [item.id]: { ...choiceOf(item), ...patch } }))
  const picked = items.filter((i) => selected.has(i.id))
  const selectable = items.filter(acceptable)
  const allSelected = picked.length === selectable.length && selectable.length > 0
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const afterChange = (left: Recording | null) => {
    if (!left) void navigate({ to: '/recording', search: { tab: 'review' } })
    else setSelected((prev) => new Set([...prev].filter((id) => left.items.some((i) => i.id === id))))
  }

  const onAccept = async () => {
    const payload = acceptPayload(picked.map((item) => ({ item, ...choiceOf(item) })), allIntegrations, plain)
    try {
      const result = await accept.mutateAsync({ id: recording.id, items: payload, owner })
      setErrors(Object.fromEntries(result.failed.map((f) => [f.id, f.error])))
      if (result.created.length > 0) {
        toast.success(result.created.length === 1 ? t('recording.acceptedOne') : t('recording.accepted', { count: result.created.length }))
      }
      if (result.failed.length > 0) toast.error(t('recording.acceptFailed', { count: result.failed.length }))
      // One mock: open it (in Simple where the editor can show it). Several: stay on what is left.
      if (result.created.length === 1 && result.failed.length === 0) {
        void navigate({ to: '/mocks/$id', params: { id: result.created[0].mockId } })
        return
      }
      afterChange(result.recording)
    } catch (error) {
      toast.error(t('recording.acceptError'), { description: error instanceof Error ? error.message : undefined })
    }
  }

  const onDiscard = async (which?: string[]) => {
    try {
      const left = await discard.mutateAsync({ id: recording.id, ids: which })
      toast.success(t('recording.discarded'))
      afterChange(left)
    } catch (error) {
      toast.error(t('recording.discardFailed'), { description: error instanceof Error ? error.message : undefined })
    }
  }

  /** Drops a recorded scenario's later answers and keeps the first as a plain mock (what recording with the switch off gives). */
  const keepFirst = async (group: ReviewGroup) => {
    const [first, ...rest] = group.items
    if (rest.length > 0) {
      try {
        const left = await discard.mutateAsync({ id: recording.id, ids: rest.map((i) => i.id) })
        afterChange(left)
      } catch (error) {
        toast.error(t('recording.discardFailed'), { description: error instanceof Error ? error.message : undefined })
        return
      }
    }
    setPlain((prev) => new Set([...prev, first.id]))
    if (acceptable(first)) toggle(first.id, true)
    toast.success(t('recording.keptFirst'))
  }

  const rowFor = (item: ReviewItem) => (
    <ReviewRow
      key={item.id}
      item={item}
      plain={plain.has(item.id)}
      checked={selected.has(item.id)}
      onCheck={(on) => toggle(item.id, on)}
      choice={choiceOf(item)}
      onChoice={(patch) => setChoice(item, patch)}
      integrations={allIntegrations}
      endpoints={endpoints}
      error={errors[item.id]}
    />
  )

  const source = recording.target ?? t('recording.realDataSourceLog')
  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${ids}-title`} className="font-display text-xl font-semibold tracking-tight break-all uppercase">
          {recording.kind === 'recording' ? t('recording.listRecording', { url: recording.target ?? '?' }) : t('recording.listSnapshot')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t(items.length === 1 ? 'recording.listMetaOne' : 'recording.listMeta', {
            count: items.length,
            name: recording.createdBy,
            when: relativeTime(recording.createdAt),
            expires: relativeTime(recording.expiresAt),
          })}
        </p>
      </div>

      <Alert className="border-hazard/60 bg-hazard/10 text-foreground">
        <ShieldAlertIcon className="text-hazard-fg" />
        <AlertTitle className="font-semibold text-hazard-fg">{t('recording.realDataTitle')}</AlertTitle>
        <AlertDescription className="text-foreground/90">{t('recording.realDataBody', { source })}</AlertDescription>
      </Alert>
      {recording.dropped > 0 && <p className="text-xs text-hazard-fg">{t('recording.dropped', { count: recording.dropped })}</p>}
      {(recording.leftInWireMock ?? 0) > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t('recording.leftTitle', { count: recording.leftInWireMock ?? 0 })}</AlertTitle>
          <AlertDescription>{t(wiremockOnly ? 'recording.leftBodyWireMockOnly' : 'recording.leftBody')}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-surface-2 px-3 py-2">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={allSelected ? true : picked.length > 0 ? 'indeterminate' : false}
            onCheckedChange={(on) => setSelected(on === true ? new Set(selectable.map((i) => i.id)) : new Set())}
          />
          {t('recording.selectAll')}
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span id={`${ids}-owner`} className="text-muted-foreground">
            {t('recording.owner')}
          </span>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            aria-labelledby={`${ids}-owner`}
            aria-describedby={seedPrune ? `${ids}-prune` : undefined}
            value={owner}
            onValueChange={(v) => v && setOwner(v as 'me' | 'baseline')}
          >
            <ToggleGroupItem value="me" className={`px-2.5 text-xs ${ON}`}>
              {t('recording.ownerMe')}
            </ToggleGroupItem>
            <ToggleGroupItem value="baseline" disabled={seedPrune} className={`px-2.5 text-xs ${ON}`}>
              {t('recording.ownerBaseline')}
            </ToggleGroupItem>
          </ToggleGroup>
          {seedPrune && (
            <span id={`${ids}-prune`} className="basis-full text-[11px] text-muted-foreground sm:basis-auto sm:max-w-md">
              {t('recording.ownerBaselineSeedPrune')}
            </span>
          )}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy || picked.length === 0} onClick={() => void onDiscard(picked.map((i) => i.id))}>
            {t('recording.discardSelected')}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" disabled={busy}>
                <Trash2Icon data-icon="inline-start" />
                {t('recording.discardAll')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="glass-panel">
              <AlertDialogHeader>
                <AlertDialogTitle>{t('recording.discardAllTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('recording.discardAllBody', { count: items.length })}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void onDiscard()}>
                  {t('recording.discardAll')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" disabled={busy || picked.length === 0} onClick={() => void onAccept()}>
            {accept.isPending ? <Spinner data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
            {t('recording.accept', { count: picked.length })}
          </Button>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {groups.map((group) =>
          group.scenario === undefined || plain.has(group.items[0].id) ? (
            group.items.map(rowFor)
          ) : (
            <ScenarioGroup key={`scenario:${group.scenario}`} group={group} busy={busy} onKeepFirst={() => void keepFirst(group)}>
              {group.items.map(rowFor)}
            </ScenarioGroup>
          ),
        )}
      </ul>
    </section>
  )
}

/** A recorded scenario's rows as one item: the same request, answered differently on each call, in replay order. */
function ScenarioGroup({ group, busy, onKeepFirst, children }: { group: ReviewGroup; busy: boolean; onKeepFirst: () => void; children: ReactNode }) {
  const t = useT()
  const ids = useId()
  const first = group.items[0]
  return (
    <li aria-labelledby={`${ids}-title`} className="flex flex-col gap-2 rounded-md border border-dashed border-line p-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <GitBranchIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <MethodBadge method={first.method} />
        <span id={`${ids}-title`} className="text-xs font-medium">
          {t('recording.groupTitle', { count: group.items.length })}
        </span>
        <Button size="sm" variant="outline" className="ms-auto h-7 text-xs" disabled={busy} onClick={onKeepFirst}>
          {t('recording.keepFirst')}
        </Button>
        <p className="basis-full text-[11px] text-muted-foreground">{t('recording.groupHint', { name: group.scenario ?? '' })}</p>
      </div>
      <ol className="flex flex-col gap-2">{children}</ol>
    </li>
  )
}

function ReviewRow({
  item,
  plain,
  checked,
  onCheck,
  choice,
  onChoice,
  integrations,
  endpoints,
  error,
}: {
  item: ReviewItem
  plain: boolean
  checked: boolean
  onCheck: (on: boolean) => void
  choice: RowChoice
  onChoice: (patch: Partial<RowChoice>) => void
  integrations: Integration[]
  endpoints: Record<string, Endpoint[] | undefined>
  error?: string
}) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const hasBody = bodyText(item) !== null
  const integration = integrations.find((i) => i.key === choice.integration)
  const options = integration ? (endpoints[integration.key] ?? []) : []
  const scenario = !plain && typeof item.stub.scenarioName === 'string' ? item.stub.scenarioName : undefined
  const label = item.stub.name ?? `${item.method} ${item.url}`
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-surface p-3 transition-colors',
        checked ? 'border-signal/40' : 'border-line opacity-80',
        error && 'border-mismatch/60',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox id={id('check')} checked={checked} disabled={item.tooLarge} onCheckedChange={(on) => onCheck(on === true)} aria-label={t('recording.selectRow', { name: `${item.method} ${item.url}` })} />
        <MethodBadge method={item.method} />
        <label htmlFor={id('check')} className="min-w-0 flex-1 font-mono text-xs break-all">
          {item.url}
        </label>
        {item.status !== null ? <StatusBadge status={item.status} /> : <span className="font-mono text-[10px] text-mismatch">{t('recording.fault')}</span>}
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{item.bodySize > 0 ? formatBytes(item.bodySize) : t('recording.noBody')}</span>
      </div>
      {(item.duplicateOf || item.unmatched || item.tooLarge || scenario || plain) && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {item.duplicateOf && (
            <Link
              to="/mocks/$id"
              params={{ id: item.duplicateOf.id }}
              className="inline-flex items-center gap-1 rounded-sm border border-hazard/40 bg-hazard/10 px-1.5 py-0.5 text-hazard-fg hover:underline"
            >
              <CopyIcon aria-hidden className="size-3" />
              {t('recording.duplicate', { name: item.duplicateOf.name ?? item.duplicateOf.id })}
            </Link>
          )}
          {item.tooLarge && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-mismatch/40 bg-mismatch/10 px-1.5 py-0.5 text-mismatch">
              <FileWarningIcon aria-hidden className="size-3" />
              {t('recording.tooLarge', { size: formatBytes(item.bodySize) })}
            </span>
          )}
          {item.unmatched && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-mismatch/40 bg-mismatch/10 px-1.5 py-0.5 text-mismatch">
              <SearchXIcon aria-hidden className="size-3" />
              {t('recording.unmatched')}
            </span>
          )}
          {scenario && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-muted-foreground">
              <GitBranchIcon aria-hidden className="size-3" />
              {t('recording.scenario', { name: scenario })}
            </span>
          )}
          {plain && <span className="inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-muted-foreground">{t('recording.plain')}</span>}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={id('name')} className="text-[11px] text-muted-foreground">
            {t('recording.name')}
          </label>
          <Input id={id('name')} className="h-8 text-xs" placeholder={label} value={choice.name} onChange={(e) => onChoice({ name: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('integration')} className="text-[11px] text-muted-foreground">
            {t('recording.integration')}
          </label>
          <Select
            value={choice.integration || NONE}
            onValueChange={(v) => {
              const key = v === NONE ? '' : v
              onChoice({ integration: key, endpoint: key ? suggestLink(item, integrations.filter((i) => i.key === key), endpoints).endpoint || NEW_ENDPOINT : '' })
            }}
          >
            <SelectTrigger id={id('integration')} size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('recording.noIntegration')}</SelectItem>
              {integrations.map((i) => (
                <SelectItem key={i.key} value={i.key}>
                  {i.name} <span className="font-mono text-muted-foreground">{i.prefix}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id('endpoint')} className="text-[11px] text-muted-foreground">
            {t('recording.endpoint')}
          </label>
          <Select value={choice.endpoint || NONE} disabled={!integration} onValueChange={(v) => onChoice({ endpoint: v === NONE ? '' : v })}>
            <SelectTrigger id={id('endpoint')} size="sm" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('recording.noEndpoint')}</SelectItem>
              {options.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  {e.name}
                </SelectItem>
              ))}
              {integration && <SelectItem value={NEW_ENDPOINT}>{t('recording.newEndpoint', { name: newEndpointFor(item, integration).name })}</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </div>
      {hasBody && <RecordedAnswer item={item} />}
      {error && (
        <p role="alert" className="text-xs text-mismatch">
          {error}
        </p>
      )}
    </li>
  )
}

/** The recorded answer, rendered only once its <details> is opened (bodies can be up to 1 MB each). */
function RecordedAnswer({ item }: { item: ReviewItem }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <details className="group rounded-md border border-line/70 bg-surface-2" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] text-muted-foreground select-none hover:text-foreground">
        {t('recording.showBody', { size: formatBytes(item.bodySize) })}
      </summary>
      {open && (
        <pre dir="ltr" className="max-h-64 overflow-auto border-t border-line/70 px-2.5 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">
          {bodyText(item)}
        </pre>
      )}
    </details>
  )
}
