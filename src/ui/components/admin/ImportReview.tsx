import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { TagIcon } from 'lucide-react'
import type { Bundle } from '@/server/bundle/shape'
import type { ImportItem, ImportReport } from '@/server/bundle/importer'
import { normaliseTag, tagProblem } from '@/server/mocks/tags'
import { useImportPreview } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { TagChip } from '@/ui/components/mocks/TagsField'
import { Button } from '@/ui/components/ui/button'
import { Spinner } from '@/ui/components/ui/spinner'
import { Switch } from '@/ui/components/ui/switch'
import { useT } from '@/ui/i18n'
import {
  appliedGroupTag,
  findCombinable,
  groupForReview,
  type Combinable,
  initialReview,
  reviewedBundle,
  stubUrl,
  tagsForItem,
  type ReviewGroup,
  type ReviewState,
} from '@/ui/lib/import-review'
import { cn } from '@/ui/lib/utils'

/** Rows shown per group before "Show all". */
const ROWS = 50
const DRY_RUN_DELAY_MS = 350

const OUTCOME_STYLE: Record<ImportItem['outcome'], string> = {
  created: 'bg-match/10 text-match',
  updated: 'bg-hazard/10 text-hazard-fg',
  unchanged: 'bg-surface-2 text-muted-foreground',
  skipped: 'bg-mismatch/10 text-mismatch',
}

/**
 * The import's review step: the mocks grouped by a suggested tag (accept it, rename it or turn it off), each mock
 * ticked or not, tags added to the selected ones, and what the import will do (a dry run on the server, refreshed as
 * the choices change). `onBundle` reports what Import should send.
 */
export function ImportReview({
  bundle,
  prune,
  onBundle,
}: {
  bundle: Bundle
  prune: boolean
  onBundle: (reviewed: Bundle, count: number) => void
}) {
  const t = useT()
  const ids = useId()
  const groups = useMemo(() => groupForReview(bundle), [bundle])
  const combinable = useMemo(() => findCombinable(bundle), [bundle])
  const [state, setState] = useState<ReviewState>(() => initialReview(groups, combinable))
  const [bulk, setBulk] = useState('')
  const [bulkProblem, setBulkProblem] = useState<string | null>(null)
  const reviewed = useMemo(() => reviewedBundle(bundle, groups, state, combinable), [bundle, groups, state, combinable])

  const onBundleRef = useRef(onBundle)
  onBundleRef.current = onBundle
  useEffect(() => onBundleRef.current(reviewed.bundle, reviewed.sent.length), [reviewed])

  // The dry run: what the server would do with exactly this bundle; the latest answer wins.
  const preview = useImportPreview()
  const [report, setReport] = useState<ImportReport | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const asked = useRef(0)
  useEffect(() => {
    const n = ++asked.current
    const timer = setTimeout(() => {
      preview
        .mutateAsync({ bundle: reviewed.bundle, prune })
        .then((r) => {
          if (n !== asked.current) return
          setReport(r)
          setPreviewError(null)
        })
        .catch((error: unknown) => {
          if (n !== asked.current) return
          setReport(null)
          setPreviewError(error instanceof Error ? error.message : String(error))
        })
    }, DRY_RUN_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mutation object changes every render
  }, [reviewed, prune])

  const outcomes = useMemo(() => {
    const map = new Map<number, ImportItem>()
    for (const item of report?.items ?? []) {
      const original = reviewed.sent[item.index]
      if (original !== undefined) map.set(original, item)
    }
    return map
  }, [report, reviewed])

  const off = new Set(state.off)
  const selected = bundle.mocks.length - off.size
  const update = (patch: Partial<ReviewState>) => setState((s) => ({ ...s, ...patch }))
  const toggle = (indexes: number[], on: boolean) =>
    setState((s) => {
      const next = new Set(s.off)
      for (const i of indexes) {
        if (on) next.delete(i)
        else next.add(i)
      }
      return { ...s, off: [...next] }
    })
  const applyBulk = () => {
    const tag = normaliseTag(bulk)
    if (!tag) return
    if (tagProblem(tag)) {
      setBulkProblem(t('tags.invalid', { tag }))
      return
    }
    setBulkProblem(null)
    setBulk('')
    setState((s) => {
      const extra = { ...s.extra }
      bundle.mocks.forEach((_, i) => {
        if (s.off.includes(i)) return
        const current = extra[i] ?? []
        if (!current.includes(tag)) extra[i] = [...current, tag]
      })
      return { ...s, extra }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium">{t('review.title')}</h3>
        <p className="text-[11px] text-muted-foreground">{t('review.intro')}</p>
      </div>

      {combinable.map((c) => (
        <CombineCard key={c.key} c={c} on={Boolean(state.combine[c.key])} onChange={(on) => update({ combine: { ...state.combine, [c.key]: on } })} />
      ))}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-xs">
        <span className="font-medium tabular-nums">{t('review.selected', { count: selected, total: bundle.mocks.length })}</span>
        <label htmlFor={`${ids}-bulk`} className="ms-auto text-muted-foreground">
          {t('review.bulkLabel')}
        </label>
        <input
          id={`${ids}-bulk`}
          value={bulk}
          onChange={(e) => {
            setBulk(e.target.value)
            setBulkProblem(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyBulk()
            }
          }}
          placeholder={t('review.bulkPlaceholder')}
          aria-invalid={bulkProblem !== null}
          aria-describedby={bulkProblem ? `${ids}-bulk-problem` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-7 w-40 rounded-md border border-line bg-surface px-2 font-mono text-xs outline-none focus-visible:border-signal aria-invalid:border-mismatch"
        />
        <Button type="button" size="sm" variant="outline" disabled={selected === 0 || bulk.trim() === ''} onClick={applyBulk}>
          <TagIcon data-icon="inline-start" />
          {t('review.bulkApply')}
        </Button>
        {bulkProblem && (
          <p id={`${ids}-bulk-problem`} role="alert" className="basis-full text-[11px] text-mismatch">
            {bulkProblem}
          </p>
        )}
      </div>

      {groups.map((group) => (
        <GroupCard
          key={group.key}
          group={group}
          bundle={bundle}
          state={state}
          outcomes={outcomes}
          onTag={(tag) => update({ tags: { ...state.tags, [group.key]: tag } })}
          onAccept={(on) => update({ accepted: { ...state.accepted, [group.key]: on } })}
          onToggle={toggle}
        />
      ))}

      <p role="status" className="flex flex-wrap items-center gap-2 text-xs">
        {preview.isPending && <Spinner />}
        {previewError ? (
          <span className="text-mismatch">{t('review.previewFailed', { message: previewError })}</span>
        ) : report ? (
          <span>{summaryText(t, report, bundle.mocks.length - selected)}</span>
        ) : (
          <span className="text-muted-foreground">{t('review.checking')}</span>
        )}
      </p>
    </div>
  )
}

/** "3 stubs differ only by one part of the URL": fold them into one mock with several responses, or keep them apart. */
function CombineCard({ c, on, onChange }: { c: Combinable; on: boolean; onChange: (on: boolean) => void }) {
  const t = useT()
  const ids = useId()
  const count = c.members.length + (c.fallback !== undefined ? 1 : 0)
  const values = c.members.map((m) => m.value).join(', ')
  return (
    <section aria-labelledby={`${ids}-t`} className="flex flex-wrap items-center gap-3 rounded-md border border-hazard/40 bg-hazard/5 px-3 py-2.5 text-xs">
      <div className="flex min-w-0 flex-1 basis-80 flex-col gap-0.5">
        <h4 id={`${ids}-t`} className="font-medium">
          {t('review.combineTitle', { count })}
        </h4>
        <p className="text-muted-foreground">
          <span dir="ltr" className="font-mono text-foreground">
            {c.method} {c.template}
          </span>{' '}
          {t(c.fallback !== undefined ? 'review.combineBodyFallback' : 'review.combineBody', { values, param: c.param, count })}
        </p>
      </div>
      <div role="radiogroup" aria-labelledby={`${ids}-t`} className="flex gap-1 rounded-md border border-hazard/40 bg-surface p-0.5">
        {([true, false] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={on === value}
            onClick={() => onChange(value)}
            className={cn('rounded px-2 py-1', on === value ? 'bg-hazard/15 text-hazard-fg' : 'text-muted-foreground hover:text-foreground')}
          >
            {value ? t('review.combineOn', { count }) : t('review.combineOff', { count })}
          </button>
        ))}
      </div>
    </section>
  )
}

function summaryText(t: ReturnType<typeof useT>, r: ImportReport, unticked: number): string {
  const parts = [t('review.sumCreates', { count: r.created }), t('review.sumUpdates', { count: r.updated }), t('review.sumUnchanged', { count: r.unchanged })]
  if (r.skipped.length > 0) parts.push(t('review.sumSkipped', { count: r.skipped.length }))
  if (unticked > 0) parts.push(t('review.sumUnticked', { count: unticked }))
  if (r.pruned > 0) parts.push(t('review.sumPruned', { count: r.pruned }))
  return parts.join(' · ')
}

function GroupCard({
  group,
  bundle,
  state,
  outcomes,
  onTag,
  onAccept,
  onToggle,
}: {
  group: ReviewGroup
  bundle: Bundle
  state: ReviewState
  outcomes: Map<number, ImportItem>
  onTag: (tag: string) => void
  onAccept: (on: boolean) => void
  onToggle: (indexes: number[], on: boolean) => void
}) {
  const t = useT()
  const ids = useId()
  const [all, setAll] = useState(false)
  const off = new Set(state.off)
  const ticked = group.indexes.filter((i) => !off.has(i)).length
  const shown = all ? group.indexes : group.indexes.slice(0, ROWS)
  const suggests = group.reason.kind === 'integration' || group.reason.kind === 'prefix'
  const typed = state.tags[group.key] ?? ''
  const normalised = normaliseTag(typed)
  const invalid = normalised !== null && tagProblem(normalised) !== undefined
  const reason =
    group.reason.kind === 'integration'
      ? t('review.reasonIntegration', { integration: group.reason.integration })
      : group.reason.kind === 'prefix'
        ? t('review.reasonPrefix', { prefix: group.reason.prefix })
        : group.reason.kind === 'tagged'
          ? t('review.reasonTagged')
          : t('review.reasonNone')
  const groupLabel = suggests ? t('review.groupLabel', { tag: normalised ?? group.tag }) : reason

  return (
    <section aria-label={groupLabel} className="overflow-hidden rounded-md border border-line">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-2/40 px-3 py-2 text-xs">
        <input
          type="checkbox"
          aria-label={t('review.groupToggle', { group: groupLabel })}
          checked={ticked === group.indexes.length}
          ref={(el) => {
            if (el) el.indeterminate = ticked > 0 && ticked < group.indexes.length
          }}
          onChange={(e) => onToggle(group.indexes, e.target.checked)}
          className="size-4 shrink-0 accent-[var(--signal)]"
        />
        {suggests ? (
          <>
            <label htmlFor={`${ids}-tag`} className="font-medium">
              {t('review.suggested')}
            </label>
            <input
              id={`${ids}-tag`}
              value={typed}
              disabled={!state.accepted[group.key]}
              onChange={(e) => onTag(e.target.value)}
              aria-invalid={invalid}
              aria-describedby={`${ids}-reason`}
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-44 rounded-full border border-signal/40 bg-surface px-3 font-mono text-xs text-signal-fg outline-none focus-visible:border-signal disabled:opacity-50 aria-invalid:border-mismatch"
            />
            <span id={`${ids}-reason`} className="text-muted-foreground">
              {reason}
            </span>
            <label className="ms-auto flex items-center gap-2">
              <Switch checked={Boolean(state.accepted[group.key])} onCheckedChange={onAccept} aria-label={t('review.apply', { tag: normalised ?? group.tag })} />
              <span>{t(state.accepted[group.key] ? 'review.applied' : 'review.notApplied')}</span>
            </label>
            {invalid && normalised && (
              <p role="alert" className="basis-full text-[11px] text-mismatch">
                {t('tags.invalid', { tag: normalised })}
              </p>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{reason}</span>
        )}
      </div>
      <ul className="divide-y divide-line">
        {shown.map((index) => {
          const stub = bundle.mocks[index]!
          const on = !off.has(index)
          const outcome = on ? outcomes.get(index) : undefined
          const tags = on ? tagsForItem(stub, index, group, state) : []
          const method = typeof stub.request?.method === 'string' ? stub.request.method : 'ANY'
          const name = typeof stub.name === 'string' && stub.name !== '' ? stub.name : `${method} ${(stubUrl(stub) ?? '—')}`
          return (
            <li key={index} className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-xs', !on && 'opacity-60')}>
              <input
                type="checkbox"
                aria-label={t('review.itemToggle', { name })}
                checked={on}
                onChange={(e) => onToggle([index], e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--signal)]"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium [overflow-wrap:anywhere]">{name}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <MethodBadge method={method} />
                  <span dir="ltr" className="font-mono text-muted-foreground [overflow-wrap:anywhere]">
                    {(stubUrl(stub) ?? '—')}
                  </span>
                </span>
                {tags.length > 0 && (
                  <ul aria-label={t('tags.label')} className="mt-0.5 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <li key={tag}>
                        <TagChip tag={tag} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px]', on ? (outcome ? OUTCOME_STYLE[outcome.outcome] : 'text-muted-foreground') : 'text-muted-foreground')}>
                {!on ? t('review.outcomeOff') : outcome ? t(`review.outcome.${outcome.outcome}`, { reason: outcome.reason ?? '' }) : '…'}
              </span>
            </li>
          )
        })}
      </ul>
      {!all && group.indexes.length > ROWS && (
        <div className="border-t border-line px-3 py-2">
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setAll(true)}>
            {t('review.showAll', { count: group.indexes.length })}
          </Button>
        </div>
      )}
      {appliedGroupTag(group, state) === undefined && suggests && state.accepted[group.key] && !invalid && (
        <p className="border-t border-line px-3 py-2 text-[11px] text-muted-foreground">{t('review.emptyTag')}</p>
      )}
    </section>
  )
}
