import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { AuditView } from '@/server/audit/view'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { type MessageKey, translate, useT } from '@/ui/i18n'
import { isValidDate, relativeTime } from '@/ui/lib/time'
import { cn } from '@/ui/lib/utils'

const COLUMNS = [
  { key: 'audit.colTime', hide: false },
  { key: 'audit.colWhat', hide: false },
  { key: 'audit.colDetails', hide: true },
] as const

function TableShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((col) => (
              <TableHead key={col.key} className={cn('text-[11px] tracking-[0.14em] text-muted-foreground uppercase', col.hide && 'hidden md:table-cell')}>
                {t(col.key)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </div>
  )
}

export function AuditTableSkeleton() {
  return (
    <TableShell>
      <TableBody>
        {Array.from({ length: 8 }, (_, i) => (
          <TableRow key={i}>
            {Array.from({ length: 3 }, (_, j) => (
              <TableCell key={j} className={cn(j > 1 && 'hidden md:table-cell')}>
                <Skeleton className="h-4 w-full max-w-48" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

/** Details as `key: value` pairs, values on one line (objects as compact JSON). */
export function detailPairs(details: AuditView['details']): [string, string][] {
  if (!details) return []
  return Object.entries(details).map(([k, v]) => [k, typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)])
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

/** The sentence's message key and its values (all but the target, which is a link). */
export function auditSentence(entry: Pick<AuditView, 'action' | 'target' | 'details' | 'subject'>): { key: MessageKey; vars: Record<string, string | number> } {
  const d = entry.details ?? {}
  const known = `audit.say.${entry.action}` as MessageKey
  switch (entry.action) {
    case 'mock.create':
      return { key: d.source === 'recording' ? 'audit.say.mock.create.recording' : known, vars: {} }
    case 'mock.reset-mine':
      return { key: known, vars: { deleted: num(d.deleted) } }
    case 'mock.restore':
      return { key: known, vars: { fromVersion: str(d.fromVersion) } }
    case 'recording.start':
      return { key: known, vars: { url: str(d.target) } }
    case 'recording.stop':
      return { key: known, vars: { url: str(d.target), recorded: num(d.recorded) } }
    case 'recording.snapshot':
      return { key: known, vars: { recorded: num(d.recorded) } }
    case 'recording.discard':
      return { key: num(d.discarded) === 1 ? 'audit.say.recording.discard.one' : known, vars: { discarded: num(d.discarded) } }
    case 'recording.accept': {
      const accepted = num(d.accepted)
      const failed = num(d.failed)
      if (failed > 0) return { key: 'audit.say.recording.accept.failed', vars: { accepted, failed, total: accepted + failed } }
      return { key: accepted === 1 ? 'audit.say.recording.accept.one' : known, vars: { accepted } }
    }
    case 'import':
      return { key: known, vars: { created: num(d.created), updated: num(d.updated) } }
    case 'user.create':
      return { key: d.bootstrap === true ? 'audit.say.user.create.bootstrap' : known, vars: {} }
    case 'scenario.set-state':
      return { key: known, vars: { state: str(d.state) } }
    case 'adopt':
      return { key: known, vars: { count: num(d.count) } }
    case 'sync':
      return { key: known, vars: { stubs: num(d.stubs) } }
    case 'mock.delete':
      // A deleted mock's name is gone with it.
      return { key: entry.subject?.name === null ? 'audit.say.mock.delete.gone' : known, vars: {} }
    case 'mock.update':
    case 'mock.duplicate':
    case 'catalog.integration.upsert':
    case 'catalog.integration.delete':
    case 'catalog.endpoint.upsert':
    case 'catalog.endpoint.delete':
    case 'requests.clear':
    case 'user.update':
    case 'user.delete':
    case 'user.password':
    case 'scenario.reset-all':
      return { key: known, vars: {} }
    default:
      return { key: entry.target ? 'audit.say.other' : 'audit.say.otherNoTarget', vars: { action: entry.action } }
  }
}

const LINK = 'font-medium text-foreground underline decoration-line underline-offset-2 hover:text-signal-fg hover:decoration-signal-fg'

/** The target: a link to the mock, integration, endpoint or scenario by name, "deleted mock" when it is gone. */
function Target({ entry }: { entry: AuditView }) {
  const t = useT()
  const target = entry.target ?? ''
  const subject = entry.subject
  if (subject) {
    // A deleted integration, endpoint or user is still named by its key.
    if (subject.name === null && subject.kind !== 'mock' && entry.action.endsWith('.delete')) {
      return (
        <span dir="ltr" className="font-mono">
          {target}
        </span>
      )
    }
    if (subject.name === null) {
      return (
        <span className="text-muted-foreground italic" title={target}>
          {t(`audit.deleted.${subject.kind}`)}
        </span>
      )
    }
    if (subject.kind === 'mock') {
      return (
        <Link to="/mocks/$id" params={{ id: target }} className={LINK}>
          {subject.name}
        </Link>
      )
    }
    // Retired integrations and endpoints (old entries) are named by their key, without a page to link to.
    return <span className="font-medium">{subject.name}</span>
  }
  if (entry.action === 'scenario.set-state') {
    return (
      <Link to="/scenarios" search={{ scenario: target }} className={LINK}>
        {target}
      </Link>
    )
  }
  return (
    <span dir="ltr" className="font-mono">
      {target}
    </span>
  )
}

/** "sara accepted 3 recorded mocks": the actor, then the sentence with its target in place. */
export function AuditSentence({ entry }: { entry: AuditView }) {
  const { key, vars } = auditSentence(entry)
  const MARK = '\u0001'
  const parts = translate(key, { ...vars, target: MARK }).split(MARK)
  const sentence: ReactNode[] = []
  parts.forEach((part, i) => {
    if (i > 0) sentence.push(<Target key={`t${i}`} entry={entry} />)
    if (part) sentence.push(part)
  })
  return (
    <p className="text-sm leading-snug">
      <span className="font-semibold text-signal-fg">{entry.actor}</span> {sentence}
    </p>
  )
}

function Details({ entry }: { entry: AuditView }) {
  const pairs = detailPairs(entry.details)
  if (pairs.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <dl className="flex flex-col gap-0.5">
      {pairs.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-muted-foreground">{k}:</dt>
          <dd dir="ltr" className="min-w-0 truncate font-mono" title={v}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function AuditTable({ entries }: { entries: AuditView[] }) {
  return (
    <TableShell>
      <TableBody>
        {entries.map((entry, i) => (
          <TableRow key={`${entry.at}-${i}`} className="align-top hover:bg-surface-2">
            <TableCell className="text-xs whitespace-nowrap">
              {isValidDate(entry.at) ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <time dateTime={entry.at} className="cursor-default text-muted-foreground">
                      {relativeTime(entry.at)}
                    </time>
                  </TooltipTrigger>
                  <TooltipContent>{new Date(entry.at).toLocaleString('en')}</TooltipContent>
                </Tooltip>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell className="min-w-56 whitespace-normal">
              <AuditSentence entry={entry} />
              <p dir="ltr" className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {entry.action}
              </p>
              <div className="mt-1 text-xs md:hidden">
                <Details entry={entry} />
              </div>
            </TableCell>
            <TableCell className="hidden max-w-80 text-xs whitespace-normal md:table-cell">
              <Details entry={entry} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}
