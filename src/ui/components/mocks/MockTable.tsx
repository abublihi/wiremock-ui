import { useState } from 'react'
import { tagsOf } from '@/server/mocks/tags'
import { TagChip } from './TagsField'
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon, MoreHorizontalIcon, PencilIcon, WebhookIcon, WorkflowIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { useT } from '@/ui/i18n'
import { groupMocks } from '@/ui/lib/scenario-builder'
import { relativeTime } from '@/ui/lib/time'
import { cn } from '@/ui/lib/utils'
import { MockRowActions, mockName } from './MockActions'
import { GroupRowActions } from './GroupActions'
import { groupOf } from '@/server/mocks/groups'
import { byLabel } from '@/ui/lib/groups'
import { ListTreeIcon } from 'lucide-react'

const URL_FIELDS = ['url', 'urlPath', 'urlPattern', 'urlPathPattern', 'urlPathTemplate'] as const

export function requestUrl(stub: StubMapping): string {
  for (const field of URL_FIELDS) {
    const value = stub.request[field]
    if (typeof value === 'string') return value
  }
  return '—'
}

const hasWebhook = (stub: StubMapping) =>
  Array.isArray(stub.serveEventListeners) &&
  stub.serveEventListeners.some((l: unknown) => typeof l === 'object' && l !== null && (l as { name?: unknown }).name === 'webhook')

/** In place of a status: WireMock forwards the request, so the real service picks the status. */
function ProxyBadge({ url }: { url: string }) {
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex h-5 shrink-0 cursor-default items-center rounded-sm border border-dashed border-signal/45 px-1.5 font-mono text-[11px] font-semibold tracking-wider text-signal-fg uppercase"
        >
          {t('mocks.proxy')}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span dir="ltr" className="font-mono">
          {t('mocks.proxyHint', { url })}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function WebhookMark() {
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="ms-1.5 inline-flex cursor-default align-[-2px] text-muted-foreground hover:text-signal-fg">
          <WebhookIcon aria-hidden className="size-3.5" />
          <span className="sr-only">{t('mocks.webhook')}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent aria-hidden>{t('mocks.webhook')}</TooltipContent>
    </Tooltip>
  )
}

/** An owner name, or the Baseline badge for mocks nobody owns. */
function Owner({ owner }: { owner: string }) {
  const t = useT()
  return owner === 'baseline' ? (
    <Badge variant="outline" className="border-hazard/40 bg-hazard/10 text-hazard-fg">
      {t('mocks.baseline')}
    </Badge>
  ) : (
    <span className="text-xs">{owner}</span>
  )
}

function UpdatedAt({ iso }: { iso?: string }) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return <span className="text-muted-foreground">—</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso} className="cursor-default text-muted-foreground">
          {relativeTime(iso)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{new Date(iso).toLocaleString('en')}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The mock rows. A scenario's mocks (one per step) show as one collapsible row, placed where its first mock is; the
 * grouping works on the rows given (the server keeps a scenario's mocks on one page). `expanded`: groups start open,
 * so a filter's hits inside a scenario are visible; the user can still collapse each one.
 */
export function MockTable({ mocks, expanded = false }: { mocks: StubMapping[]; expanded?: boolean }) {
  // The groups the user flipped away from the default (open when `expanded`, closed otherwise).
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const [wasExpanded, setWasExpanded] = useState(expanded)
  if (wasExpanded !== expanded) {
    setWasExpanded(expanded)
    setFlipped(new Set())
  }
  const isOpen = (name: string) => expanded !== flipped.has(name)
  const toggle = (name: string) =>
    setFlipped((all) => {
      const next = new Set(all)
      if (!next.delete(name)) next.add(name)
      return next
    })
  return (
    <TableShell>
      <TableBody className="stagger-children max-sm:block">
        {groupMocks(mocks).map((row) =>
          row.kind === 'mock' ? (
            <MockRow key={row.stub.id} stub={row.stub} />
          ) : row.kind === 'group' ? (
            <GroupRows key={`group:${row.id}`} id={row.id} mocks={row.mocks} open={isOpen(`group:${row.id}`)} onToggle={() => toggle(`group:${row.id}`)} />
          ) : (
            <ScenarioRows key={`scenario:${row.name}`} name={row.name} mocks={row.mocks} open={isOpen(row.name)} onToggle={() => toggle(row.name)} />
          ),
        )}
      </TableBody>
    </TableShell>
  )
}

// Below 640 px a row is a card: name and menu on top, then method + the whole path, then the status.
const ROW_CARD = 'max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-start max-sm:gap-x-2 max-sm:gap-y-1.5 max-sm:py-2'
const NAME_CELL = 'max-w-28 whitespace-normal [overflow-wrap:break-word] md:max-w-64 max-sm:col-start-1 max-sm:row-start-1 max-sm:max-w-none max-sm:py-0'
const REQUEST_CELL = 'max-w-36 md:max-w-80 max-sm:col-span-2 max-sm:max-w-none max-sm:py-0'
const PATH = 'truncate font-mono text-xs max-sm:overflow-visible max-sm:whitespace-normal max-sm:[overflow-wrap:anywhere]'
const STATUS_CELL = 'max-sm:col-span-2 max-sm:py-0'
const ACTIONS_CELL = 'text-end max-sm:col-start-2 max-sm:row-start-1 max-sm:py-0'

function MockRow({ stub, step }: { stub: StubMapping; step?: string }) {
  const t = useT()
  const meta = stub.metadata?.wiremockUi
  const method = typeof stub.request.method === 'string' ? stub.request.method : 'ANY'
  const status = typeof stub.response.status === 'number' ? stub.response.status : 200
  const proxyUrl = typeof stub.response.proxyBaseUrl === 'string' ? stub.response.proxyBaseUrl : undefined
  const owner = meta?.owner ?? 'baseline'
  return (
    <TableRow data-step={step !== undefined || undefined} className={cn('hover:bg-surface-2 data-step:bg-surface-2/40', ROW_CARD)}>
      <TableCell className={cn(NAME_CELL, step !== undefined && 'border-s-2 border-signal/40 ps-6')}>
        <Link to="/mocks/$id" params={{ id: stub.id }} className="font-medium hover:text-signal-fg hover:underline">
          {stub.name || t('mocks.unnamed')}
        </Link>
        {hasWebhook(stub) && <WebhookMark />}
        {step !== undefined ? (
          <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
            {step}
          </p>
        ) : (
          (meta?.integration || meta?.endpoint) && (
            <p className="truncate text-xs text-muted-foreground">{[meta.integration, meta.endpoint].filter(Boolean).join(' · ')}</p>
          )
        )}
        {tagsOf(stub).length > 0 && (
          <ul aria-label={t('tags.label')} className="mt-1 flex flex-wrap gap-1">
            {tagsOf(stub).map((tag) => (
              <li key={tag}>
                <TagChip tag={tag} />
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell className={REQUEST_CELL}>
        <div className="flex items-center gap-2 max-sm:items-start">
          <MethodBadge method={method} />
          <span dir="ltr" className={PATH} title={requestUrl(stub)}>
            {requestUrl(stub)}
          </span>
        </div>
      </TableCell>
      <TableCell className={STATUS_CELL}>{proxyUrl !== undefined ? <ProxyBadge url={proxyUrl} /> : <StatusBadge status={status} />}</TableCell>
      <TableCell className="hidden md:table-cell">
        <Owner owner={owner} />
      </TableCell>
      <TableCell className="hidden text-xs md:table-cell">
        <UpdatedAt iso={meta?.updatedAt} />
      </TableCell>
      <TableCell className={ACTIONS_CELL}>
        <MockRowActions stub={stub} />
      </TableCell>
    </TableRow>
  )
}

/** "Scenario: name · N steps", expandable to its step mocks, with Edit scenario and Open in Scenarios. */
function ScenarioRows({ name, mocks, open, onToggle }: { name: string; mocks: StubMapping[]; open: boolean; onToggle: () => void }) {
  const t = useT()
  const requests = [...new Set(mocks.map((m) => `${typeof m.request.method === 'string' ? m.request.method : 'ANY'} ${requestUrl(m)}`))]
  const [method, url] = requests.length === 1 ? [requests[0].split(' ')[0], requestUrl(mocks[0])] : []
  const statuses = [...new Set(mocks.map((m) => (typeof m.response.status === 'number' ? m.response.status : 200)))]
  const owners = [...new Set(mocks.map((m) => m.metadata?.wiremockUi?.owner ?? 'baseline'))]
  const latest = mocks.map((m) => m.metadata?.wiremockUi?.updatedAt).filter((d): d is string => Boolean(d)).sort().at(-1)
  const label = t(mocks.length === 1 ? 'mocks.scenarioGroupOne' : 'mocks.scenarioGroup', { name, count: mocks.length })
  const state = (stub: StubMapping) => {
    const from = typeof stub.requiredScenarioState === 'string' ? stub.requiredScenarioState : t('scenarios.anyState')
    return typeof stub.newScenarioState === 'string' ? `${from} → ${stub.newScenarioState}` : from
  }
  return (
    <>
      <TableRow data-scenario={name} className={cn('hover:bg-surface-2', ROW_CARD)}>
        <TableCell className={NAME_CELL}>
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="group flex items-start gap-1.5 rounded-sm text-start font-medium outline-none hover:text-signal-fg focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRightIcon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
            <WorkflowIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-signal-fg" />
            <span className="[overflow-wrap:break-word]">{label}</span>
          </button>
        </TableCell>
        <TableCell className={REQUEST_CELL}>
          {method ? (
            <div className="flex items-center gap-2 max-sm:items-start">
              <MethodBadge method={method} />
              <span dir="ltr" className={PATH} title={url}>
                {url}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t('mocks.scenarioRequests', { count: requests.length })}</span>
          )}
        </TableCell>
        <TableCell className={STATUS_CELL}>
          <div className="flex flex-wrap gap-1">
            {statuses.slice(0, 3).map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
            {statuses.length > 3 && <span className="text-xs text-muted-foreground">+{statuses.length - 3}</span>}
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <div className="flex flex-wrap items-center gap-1">
            {owners.map((owner) => (
              <Owner key={owner} owner={owner} />
            ))}
          </div>
        </TableCell>
        <TableCell className="hidden text-xs md:table-cell">
          <UpdatedAt iso={latest} />
        </TableCell>
        <TableCell className={ACTIONS_CELL}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('mocks.scenarioActionsFor', { name })}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/scenarios/$name/edit" params={{ name }}>
                  <PencilIcon />
                  {t('scenarios.edit')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/scenarios" search={{ scenario: name }}>
                  <WorkflowIcon />
                  {t('editor.scenario.open')}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {open && mocks.map((stub) => <MockRow key={stub.id} stub={stub} step={state(stub)} />)}
    </>
  )
}

/** A mock with several responses: one row ("Name · 3 responses (by seq)"), expandable to a row per response. */
function GroupRows({ id, mocks, open, onToggle }: { id: string; mocks: StubMapping[]; open: boolean; onToggle: () => void }) {
  const t = useT()
  const first = mocks[0]!
  const meta = groupOf(first)!
  const method = typeof first.request.method === 'string' ? first.request.method : 'ANY'
  const statuses = [...new Set(mocks.map((m) => (typeof m.response.status === 'number' ? m.response.status : 200)))]
  const owners = [...new Set(mocks.map((m) => m.metadata?.wiremockUi?.owner ?? 'baseline'))]
  const latest = mocks.map((m) => m.metadata?.wiremockUi?.updatedAt).filter((d): d is string => Boolean(d)).sort().at(-1)
  const by = byLabel(meta.by)
  const label = t(mocks.length === 1 ? 'groups.countOne' : 'groups.count', { count: mocks.length, by })
  const tags = tagsOf(first)
  const step = (stub: StubMapping) => {
    const value = groupOf(stub)?.value
    return value === undefined ? t('groups.anyOther', { by }) : t('groups.when', { by, value })
  }
  return (
    <>
      <TableRow data-group={id} className={cn('hover:bg-surface-2', ROW_CARD)}>
        <TableCell className={NAME_CELL}>
          <div className="flex items-start gap-1.5">
            <button
              type="button"
              aria-expanded={open}
              aria-label={t('groups.toggle', { name: first.name || t('mocks.unnamed') })}
              onClick={onToggle}
              className="mt-0.5 rounded-sm outline-none hover:text-signal-fg focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRightIcon aria-hidden className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
            </button>
            <div className="min-w-0">
              <Link to="/mocks/$id" params={{ id: first.id }} className="font-medium hover:text-signal-fg hover:underline">
                {first.name || t('mocks.unnamed')}
              </Link>
              <p className="flex items-center gap-1 text-xs text-hazard-fg">
                <ListTreeIcon aria-hidden className="size-3.5 shrink-0" />
                {label}
              </p>
              {tags.length > 0 && (
                <ul aria-label={t('tags.label')} className="mt-1 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <li key={tag}>
                      <TagChip tag={tag} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell className={REQUEST_CELL}>
          <div className="flex items-center gap-2 max-sm:items-start">
            <MethodBadge method={method} />
            <span dir="ltr" className={PATH} title={requestUrl(first)}>
              {requestUrl(first)}
            </span>
          </div>
        </TableCell>
        <TableCell className={STATUS_CELL}>
          <div className="flex flex-wrap gap-1">
            {statuses.slice(0, 3).map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
            {statuses.length > 3 && <span className="text-xs text-muted-foreground">+{statuses.length - 3}</span>}
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <div className="flex flex-wrap items-center gap-1">
            {owners.map((owner) => (
              <Owner key={owner} owner={owner} />
            ))}
          </div>
        </TableCell>
        <TableCell className="hidden text-xs md:table-cell">
          <UpdatedAt iso={latest} />
        </TableCell>
        <TableCell className={ACTIONS_CELL}>
          <GroupRowActions id={id} first={first} name={first.name || t('mocks.unnamed')} />
        </TableCell>
      </TableRow>
      {open && mocks.map((stub) => <MockRow key={stub.id} stub={stub} step={step(stub)} />)}
    </>
  )
}

export function MockTableSkeleton() {
  return (
    <TableShell>
      <TableBody>
        {Array.from({ length: 6 }, (_, i) => (
          <TableRow key={i}>
            {Array.from({ length: 6 }, (_, j) => (
              <TableCell key={j}>
                <Skeleton className="h-4 w-full max-w-32" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

function TableShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <Table className="max-sm:block">
        <TableHeader className="max-sm:hidden">
          <TableRow className="hover:bg-transparent">
            {(['Name', 'Request', 'Status', 'Owner', 'Updated'] as const).map((col) => (
              <TableHead key={col} className={cn('text-[11px] tracking-[0.14em] text-muted-foreground uppercase', (col === 'Owner' || col === 'Updated') && 'hidden md:table-cell')}>
                {t(`mocks.col${col}`)}
              </TableHead>
            ))}
            <TableHead className="w-10">
              <span className="sr-only">{t('mocks.colActions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </div>
  )
}
