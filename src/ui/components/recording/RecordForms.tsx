import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CircleDotIcon, FileStackIcon, ShieldAlertIcon, SquareIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PATH_MODES, resolvePathFilter, typedAsPath, type PathMode } from '@/server/recording/path-pattern'
import type { EmptyResult, RecordingState, SnapshotInput } from '@/server/recording/service'
import { useSnapshot, useStartRecording, useStopRecording } from '@/ui/api/queries'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Spinner } from '@/ui/components/ui/spinner'
import { Switch } from '@/ui/components/ui/switch'
import { useWiremockPublicUrl } from '@/ui/config'
import { translate, useT } from '@/ui/i18n'
import { relativeTime } from '@/ui/lib/time'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
const ALL = 'all'

type Filters = { method: string; urlPathPattern: string; urlPathMode: PathMode; captureHeaders: string; repeatsAsScenarios: boolean }
const EMPTY: Filters = { method: ALL, urlPathPattern: '', urlPathMode: 'auto', captureHeaders: '', repeatsAsScenarios: true }

/**
 * Why a stop or snapshot gave no review list, in words: the filters left out the requests that went through (and
 * which filters), or no request reached WireMock at all.
 */
export function emptyMessage(empty: EmptyResult | undefined, kind: 'recording' | 'snapshot'): string {
  const t = translate
  if (!empty) return t(kind === 'recording' ? 'recording.stoppedEmpty' : 'recording.snapshotEmpty')
  if (empty.reason === 'noTraffic') return kind === 'recording' ? t('recording.emptyNoTraffic', { url: empty.wiremockUrl }) : t('recording.snapshotEmpty')
  const parts = [
    empty.filters.method && t('recording.filterMethod', { method: empty.filters.method }),
    empty.filters.urlPathPattern && t('recording.filterPath', { pattern: empty.filters.urlPathPattern }),
  ].filter(Boolean)
  const filters = parts.length > 0 ? parts.join(', ') : t('recording.filterNone')
  const one = empty.requests === 1
  if (kind === 'recording') return t(one ? 'recording.emptyFilteredOne' : 'recording.emptyFiltered', { count: empty.requests, filters })
  return t(one ? 'recording.snapshotFilteredOne' : 'recording.snapshotFiltered', { count: empty.requests, filters })
}

/** The filter fields as the API takes them (empty ones left out). */
function filterInput(f: Filters): Omit<SnapshotInput, 'ids'> {
  const headers = f.captureHeaders
    .split(/[,\s]+/)
    .map((h) => h.trim())
    .filter(Boolean)
  return {
    ...(f.method !== ALL ? { method: f.method as SnapshotInput['method'] } : {}),
    ...(f.urlPathPattern.trim() ? { urlPathPattern: f.urlPathPattern.trim(), ...(f.urlPathMode !== 'auto' ? { urlPathMode: f.urlPathMode } : {}) } : {}),
    ...(headers.length > 0 ? { captureHeaders: headers } : {}),
    repeatsAsScenarios: f.repeatsAsScenarios,
  }
}

function FilterFields({ value, onChange }: { value: Filters; onChange: (next: Filters) => void }) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const typed = value.urlPathPattern.trim()
  // How the value is read (auto: a regex when it uses regex-only syntax), what WireMock gets, and a regex that can
  // never match a path, with its fix.
  const path = typed ? resolvePathFilter(typed, value.urlPathMode) : null
  const problem = path?.kind === 'regex' ? path.problem : null
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">// {t('recording.filters')}</legend>
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field>
          <FieldLabel htmlFor={id('method')}>{t('recording.method')}</FieldLabel>
          <Select value={value.method} onValueChange={(method) => onChange({ ...value, method })}>
            <SelectTrigger id={id('method')} className="w-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('recording.methodAll')}</SelectItem>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m} className="font-mono">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={id('pattern')}>{t('recording.pathPattern')}</FieldLabel>
          <Input
            id={id('pattern')}
            dir="ltr"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            placeholder={value.urlPathMode === 'regex' ? '/api/Products.*' : '/api/*'}
            value={value.urlPathPattern}
            aria-invalid={Boolean(problem)}
            aria-describedby={[id('pattern-hint'), path && id('pattern-check')].filter(Boolean).join(' ')}
            onChange={(e) => onChange({ ...value, urlPathPattern: e.target.value })}
          />
          <FieldDescription id={id('pattern-hint')} className="text-xs">
            {t(value.urlPathMode === 'regex' ? 'recording.pathRegexHint' : 'recording.pathPatternHint')}
          </FieldDescription>
          {path && (
            <div id={id('pattern-check')} className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
              {path.kind === 'wildcard' ? (
                <span>
                  {t('recording.pathMatchesWildcard', { example: path.example })}{' '}
                  <code dir="ltr" className="rounded-sm bg-surface-2 px-1 font-mono text-foreground">
                    {path.regex}
                  </code>
                </span>
              ) : (
                <span>{t('recording.pathMatchesRegex')}</span>
              )}
              {path.kind === 'wildcard' && path.droppedQuery && (
                <span className="text-hazard-fg">{t('recording.pathDroppedQuery', { query: path.droppedQuery })}</span>
              )}
              {path.kind === 'wildcard' && path.addedSlash && <span>{t('recording.pathAddedSlash')}</span>}
              {problem && (
                <span role="alert" className="flex flex-col items-start gap-1.5 text-hazard-fg">
                  <span className="flex items-start gap-1.5">
                    <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                    {t(problem.kind === 'query' ? 'recording.pathRegexQuery' : 'recording.pathRegexStart', {
                      typed: typedAsPath(typed),
                      suggestion: problem.suggestion,
                    })}
                  </span>
                  <Button type="button" variant="outline" size="xs" onClick={() => onChange({ ...value, urlPathPattern: problem.suggestion })}>
                    {t('recording.pathUse', { suggestion: problem.suggestion })}
                  </Button>
                </span>
              )}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <FieldLabel htmlFor={id('mode')} className="text-xs font-normal text-muted-foreground">
              {t('recording.pathMode')}
            </FieldLabel>
            <Select value={value.urlPathMode} onValueChange={(mode) => onChange({ ...value, urlPathMode: mode as PathMode })}>
              <SelectTrigger id={id('mode')} size="sm" className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PATH_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`recording.pathMode.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={id('headers')}>{t('recording.captureHeaders')}</FieldLabel>
        <Input
          id={id('headers')}
          dir="ltr"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder="Accept, X-Tenant"
          value={value.captureHeaders}
          aria-describedby={id('headers-hint')}
          onChange={(e) => onChange({ ...value, captureHeaders: e.target.value })}
        />
        <FieldDescription id={id('headers-hint')} className="text-xs">
          {t('recording.captureHeadersHint')}
        </FieldDescription>
      </Field>
      <Field orientation="horizontal" className="items-start">
        <Switch
          id={id('scenarios')}
          checked={value.repeatsAsScenarios}
          aria-describedby={id('scenarios-hint')}
          onCheckedChange={(on) => onChange({ ...value, repeatsAsScenarios: on })}
        />
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={id('scenarios')}>{t('recording.scenarios')}</FieldLabel>
          <FieldDescription id={id('scenarios-hint')} className="text-xs">
            {t('recording.scenariosHint')} {t('recording.inline')}
          </FieldDescription>
        </div>
      </Field>
    </fieldset>
  )
}

/** Stop the running recording and open the review list it produced. */
export function useStopAndReview() {
  const t = useT()
  const stop = useStopRecording()
  const navigate = useNavigate()
  const run = async () => {
    try {
      const result = await stop.mutateAsync()
      const { recording } = result
      if (recording) {
        toast.success(t(recording.items.length === 1 ? 'recording.stoppedOne' : 'recording.stopped', { count: recording.items.length }))
        void navigate({ to: '/recording', search: { review: recording.id } })
      } else toast.info(t('recording.stoppedEmptyTitle'), { description: emptyMessage(result.empty, 'recording'), duration: 15_000 })
    } catch (error) {
      toast.error(t('recording.stopFailed'), { description: error instanceof Error ? error.message : undefined })
    }
  }
  return { run, pending: stop.isPending }
}

/** The Record tab: how it works, the target and filters, Start; while recording, what is recorded and Stop. */
export function RecordPanel({ state }: { state: RecordingState | undefined }) {
  const t = useT()
  const ids = useId()
  const publicUrl = useWiremockPublicUrl() ?? 'WireMock'
  const [target, setTarget] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [error, setError] = useState<string>()
  const start = useStartRecording()
  const stop = useStopAndReview()

  if (state?.status === 'recording') {
    return (
      <section aria-labelledby={`${ids}-running`} className="glow-border flex flex-col gap-3 rounded-md border border-hazard/50 bg-surface p-4 sm:p-5">
        <h2 id={`${ids}-running`} className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight uppercase">
          <span aria-hidden className="recording-pulse size-2.5 rounded-full bg-mismatch" />
          <span className="min-w-0 break-all">{t('recording.runningTitle', { url: state.target ?? '?' })}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          {state.startedBy && state.startedAt
            ? t('recording.runningBy', { name: state.startedBy, when: relativeTime(state.startedAt) })
            : t('recording.runningOutside')}
        </p>
        <p className="text-sm">{t('recording.runningHint', { url: publicUrl })}</p>
        <div>
          <Button onClick={() => void stop.run()} disabled={stop.pending}>
            {stop.pending ? <Spinner data-icon="inline-start" /> : <SquareIcon data-icon="inline-start" />}
            {t('recording.stopAndReview')}
          </Button>
        </div>
      </section>
    )
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!target.trim()) {
      setError(t('recording.targetRequired'))
      return
    }
    setError(undefined)
    try {
      const next = await start.mutateAsync({ targetUrl: target.trim(), ...filterInput(filters) })
      toast.success(t('recording.started', { url: next.status === 'recording' ? (next.target ?? target) : target }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/target url/i.test(message)) setError(message)
      else toast.error(t('recording.startFailed'), { description: message })
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5 rounded-md border border-line bg-surface p-4 sm:p-5">
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor={`${ids}-target`}>{t('recording.target')}</FieldLabel>
          <Input
            id={`${ids}-target`}
            type="url"
            dir="ltr"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.example.com"
            value={target}
            aria-invalid={Boolean(error)}
            aria-describedby={[`${ids}-target-hint`, error && `${ids}-target-error`].filter(Boolean).join(' ')}
            onChange={(e) => {
              setTarget(e.target.value)
              setError(undefined)
            }}
          />
          <FieldDescription id={`${ids}-target-hint`} className="text-xs">
            {t('recording.targetHint')}
          </FieldDescription>
          {error && <FieldError id={`${ids}-target-error`}>{error}</FieldError>}
        </Field>
        <FilterFields value={filters} onChange={setFilters} />
        <p className="flex items-center gap-2 text-xs text-hazard-fg">
          <ShieldAlertIcon aria-hidden className="size-3.5 shrink-0" />
          {t('recording.realData')}
        </p>
        <div>
          <Button type="submit" disabled={start.isPending}>
            {start.isPending ? <Spinner data-icon="inline-start" /> : <CircleDotIcon data-icon="inline-start" />}
            {t('recording.start')}
          </Button>
        </div>
      </form>
      <aside aria-labelledby={`${ids}-how`} className="flex flex-col gap-3 self-start rounded-md border border-dashed border-line p-4 text-sm">
        <h2 id={`${ids}-how`} className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          // {t('recording.howTitle')}
        </h2>
        <ol className="flex list-decimal flex-col gap-2 ps-4 marker:font-mono marker:text-signal-fg">
          <li>{t('recording.how1')}</li>
          <li className="break-words">{t('recording.how2', { url: publicUrl })}</li>
          <li>{t('recording.how3')}</li>
        </ol>
        <p className="text-xs text-muted-foreground">{t('recording.howPriority')}</p>
      </aside>
    </div>
  )
}

/** The "From the request log" tab: the same filters, turned into a review list from WireMock's journal. */
export function SnapshotPanel() {
  const t = useT()
  const ids = useId()
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const snapshot = useSnapshot()
  const navigate = useNavigate()
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      const result = await snapshot.mutateAsync(filterInput(filters))
      const { recording } = result
      if (!recording) {
        toast.info(t('recording.snapshotEmptyTitle'), { description: emptyMessage(result.empty, 'snapshot'), duration: 15_000 })
        return
      }
      toast.success(t(recording.items.length === 1 ? 'recording.snapshotDoneOne' : 'recording.snapshotDone', { count: recording.items.length }))
      void navigate({ to: '/recording', search: { review: recording.id } })
    } catch (err) {
      toast.error(t('recording.snapshotFailed'), { description: err instanceof Error ? err.message : undefined })
    }
  }
  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} aria-labelledby={`${ids}-title`} className="flex max-w-3xl flex-col gap-5 rounded-md border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id={`${ids}-title`} className="font-display text-xl font-semibold tracking-tight uppercase">
          {t('recording.snapshotTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('recording.snapshotBody')}</p>
      </div>
      <FilterFields value={filters} onChange={setFilters} />
      <div>
        <Button type="submit" disabled={snapshot.isPending}>
          {snapshot.isPending ? <Spinner data-icon="inline-start" /> : <FileStackIcon data-icon="inline-start" />}
          {t('recording.snapshot')}
        </Button>
      </div>
    </form>
  )
}
