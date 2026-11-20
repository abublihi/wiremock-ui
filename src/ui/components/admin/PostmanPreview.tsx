import { useDeferredValue, useId, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircleIcon, InfoIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react'
import type { ImportReport } from '@/server/bundle/importer'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { endpointsQueryOptions, integrationsQueryOptions, useEndpoints, useImport, useIntegrations } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { Eyebrow } from '@/ui/components/editor/EditorShell'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Spinner } from '@/ui/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { useWireMockOnly } from '@/ui/config'
import { useT, type MessageKey } from '@/ui/i18n'
import { MAX_IMPORT_BYTES, megabytes } from '@/ui/lib/import-files'
import {
  commonFirstSegment,
  defaultIntegration,
  isCatalogKey,
  planPostman,
  prefixProblem,
  type IntegrationFields,
  type Plan,
  type PlanRow,
  type PostmanCollection,
  type RowAction,
  type RowChoice,
} from '@/ui/lib/postman'
import { cn } from '@/ui/lib/utils'

type Props = {
  collection: PostmanCollection
  fileName: string
  /** Called with the server's report and the integration the endpoints went into. */
  onImported: (report: ImportReport, integration: IntegrationFields) => void
  onCancel: () => void
}

/** The Postman path of the Import page: integration fields, one row per request, warnings, then one bundle import. */
export function PostmanPreview({ collection, fileName, onImported, onCancel }: Props) {
  const t = useT()
  const id = useId()
  const wiremockOnly = useWireMockOnly()
  const run = useImport()
  const [fields, setFields] = useState<IntegrationFields>(() => {
    const base = defaultIntegration(collection)
    return collection.description ? { ...base, description: collection.description } : base
  })
  const [choices, setChoices] = useState<Record<string, RowChoice>>({})
  const queryClient = useQueryClient()
  const integrations = useIntegrations()
  const stored = integrations.data?.find((i) => i.key === fields.key)
  const endpoints = useEndpoints(stored?.key)
  const common = commonFirstSegment(collection)
  const [submitting, setSubmitting] = useState(false)

  const planned = useMemo(
    () => safePlan(collection, fields, stored, endpoints.data, choices),
    [collection, fields, stored, endpoints.data, choices],
  )
  const plan = planned.plan

  const keyError = isCatalogKey(fields.key) ? undefined : 'postman.keyInvalid'
  const nameError = stored || fields.name.trim() !== '' ? undefined : 'postman.nameEmpty'
  const prefixError = stored ? undefined : prefixProblem(fields.prefix)
  // Without the stored catalog the page cannot tell an update from a new integration, or spot key clashes.
  const checking = integrations.isPending || (stored !== undefined && endpoints.isPending)
  const loadError = integrations.isError ? integrations.error : stored && endpoints.isError ? endpoints.error : null
  // The request size is checked off the typing path: a big collection re-plans on every key stroke.
  const deferredBundle = useDeferredValue(plan.bundle)
  const bytes = useMemo(() => bundleBytes(deferredBundle), [deferredBundle])
  const tooBig = bytes === undefined || bytes > MAX_IMPORT_BYTES
  const blocked =
    Boolean(keyError || nameError || prefixError || planned.error || loadError) || checking || plan.endpoints === 0 || tooBig

  const warnings = [...collection.warnings, ...collection.requests.flatMap((r) => r.notes)]
  const skipped = plan.rows.flatMap((r) => r.skipped.map((s) => ({ row: r, ...s })))
  const exampleCount = collection.requests.reduce((n, r) => n + r.examples.length, 0)
  const shownRows = plan.rows.slice(0, MAX_ROWS)

  const set = (patch: Partial<IntegrationFields>) => setFields((f) => ({ ...f, ...patch }))
  const choose = (rowId: string, patch: RowChoice) => setChoices((c) => ({ ...c, [rowId]: { ...c[rowId], ...patch } }))

  const submit = async () => {
    if (blocked || submitting) return
    setSubmitting(true)
    try {
      // Plan again from a fresh read of the catalog: someone may have added the integration or an endpoint since.
      const freshIntegrations = await queryClient.fetchQuery({ ...integrationsQueryOptions(), staleTime: 0 })
      const freshStored = freshIntegrations.find((i) => i.key === fields.key)
      const freshEndpoints = freshStored ? await queryClient.fetchQuery({ ...endpointsQueryOptions(freshStored.key), staleTime: 0 }) : undefined
      const fresh = safePlan(collection, fields, freshStored, freshEndpoints, choices)
      // What the page shows is what gets sent: when the fresh plan differs, the table re-renders and the user looks again.
      if (fresh.error || bundleText(fresh.plan.bundle) !== bundleText(plan.bundle)) return
      const size = bundleBytes(fresh.plan.bundle)
      if (size === undefined || size > MAX_IMPORT_BYTES) return
      const report = await run.mutateAsync({ bundle: fresh.plan.bundle, prune: false })
      onImported(report, fresh.plan.integration)
    } catch {
      // shown from run.error or the queries' errors
    } finally {
      setSubmitting(false)
    }
  }

  const fieldId = (name: string) => `${id}-${name}`
  return (
    <section aria-labelledby={fieldId('title')} className="glow-border flex flex-col gap-5 rounded-md border border-line bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={fieldId('title')} className="font-display text-2xl font-bold tracking-tight uppercase">
            {t('postman.title')}: <span className="normal-case">{collection.name}</span>
          </h2>
          <p className="font-mono text-xs break-all text-muted-foreground">
            {t('postman.caption', { requests: collection.requests.length, examples: exampleCount, name: fileName })}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('postman.chooseOther')}
        </Button>
      </header>

      <div className="flex flex-col gap-3">
        <Eyebrow>{t('postman.integration')}</Eyebrow>
        <p className="text-xs text-muted-foreground">{t('postman.integrationHint')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field data-invalid={Boolean(keyError)}>
            <FieldLabel htmlFor={fieldId('key')}>{t('postman.key')}</FieldLabel>
            <Input
              id={fieldId('key')}
              value={fields.key}
              onChange={(e) => set({ key: e.target.value })}
              aria-invalid={Boolean(keyError)}
              aria-describedby={keyError ? fieldId('key-error') : undefined}
              className="font-mono"
              spellCheck={false}
              autoCapitalize="off"
            />
            {keyError && <FieldError id={fieldId('key-error')}>{t(keyError)}</FieldError>}
          </Field>
          <Field data-invalid={Boolean(nameError)}>
            <FieldLabel htmlFor={fieldId('name')}>{t('postman.name')}</FieldLabel>
            <Input
              id={fieldId('name')}
              value={stored ? stored.name : fields.name}
              disabled={Boolean(stored)}
              onChange={(e) => set({ name: e.target.value })}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? fieldId('name-error') : undefined}
            />
            {nameError && <FieldError id={fieldId('name-error')}>{t(nameError)}</FieldError>}
          </Field>
          <Field data-invalid={Boolean(prefixError)}>
            <FieldLabel htmlFor={fieldId('prefix')}>{t('postman.prefix')}</FieldLabel>
            <Input
              id={fieldId('prefix')}
              value={stored ? stored.prefix : fields.prefix}
              disabled={Boolean(stored)}
              onChange={(e) => set({ prefix: e.target.value })}
              aria-invalid={Boolean(prefixError)}
              aria-describedby={prefixError ? `${fieldId('prefix-error')} ${fieldId('prefix-hint')}` : fieldId('prefix-hint')}
              className="font-mono"
              spellCheck={false}
              autoCapitalize="off"
            />
            {prefixError && <FieldError id={fieldId('prefix-error')}>{t(prefixError)}</FieldError>}
          </Field>
        </div>
        <FieldDescription id={fieldId('prefix-hint')} className="text-xs">
          {t('postman.prefixHint')}
        </FieldDescription>
        {common && !stored && fields.prefix !== common && (
          <div>
            <Button type="button" variant="outline" size="sm" className="font-mono" onClick={() => set({ prefix: common })}>
              {t('postman.useCommon', { prefix: common })}
            </Button>
          </div>
        )}
        {stored && (
          <Alert>
            <InfoIcon />
            <AlertDescription>{t('postman.existing', { name: stored.name, prefix: stored.prefix })}</AlertDescription>
          </Alert>
        )}
        {wiremockOnly && (
          <Alert>
            <InfoIcon />
            <AlertDescription>{t('postman.wiremockOnly')}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Eyebrow>{t('postman.requests')}</Eyebrow>
        <p className="text-xs text-muted-foreground">{t('postman.defaultHint')}</p>
        {stored && endpoints.isPending && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            {t('postman.loadingEndpoints', { name: stored.name })}
          </p>
        )}
        <div className="overflow-x-auto rounded-md border border-line">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {(['colMethod', 'colPath', 'colEndpoint', 'colExamples', 'colMocks', 'colDefault', 'colStatus'] as const).map((col) => (
                  <TableHead key={col} className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                    {t(`postman.${col}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownRows.map((row) => (
                <RequestRow key={row.id} row={row} onChoose={(patch) => choose(row.id, patch)} />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {skipped.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t('postman.skippedTitle', { count: skipped.length })}</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {skipped.map((s, i) => (
              <li key={`${s.row.id}-${i}`}>
                <span className="font-medium">{s.row.name}</span> · {s.name}: <span className="text-muted-foreground">{t(s.reason)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <Alert className="border-hazard/40">
          <TriangleAlertIcon className="text-hazard-fg" />
          <AlertTitle className="text-hazard-fg">{t('postman.warningsTitle')}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 ps-4 text-xs">
              {warnings.map((w, i) => (
                <li key={i}>{t(w.key, w.params)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {plan.endpoints === 0 && <p className="text-xs text-muted-foreground">{t('postman.nothing')}</p>}
      {bytes !== undefined && tooBig && (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon />
          <AlertDescription>{t('import.mergedTooLarge', { size: megabytes(bytes ?? 0) })}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon />
          <AlertTitle>{t('editor.pickLoadFailed')}</AlertTitle>
          <AlertDescription>{loadError.message || t('error.generic')}</AlertDescription>
        </Alert>
      )}
      {planned.error && (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon />
          <AlertDescription>{t('import.fileShape', { message: planned.error })}</AlertDescription>
        </Alert>
      )}
      {run.isError && (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon />
          <AlertTitle>{t('import.failed')}</AlertTitle>
          <AlertDescription>{run.error.message || t('error.generic')}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button onClick={() => void submit()} disabled={run.isPending || submitting || blocked}>
          {run.isPending || submitting ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
          {run.isPending || submitting ? t('import.running') : t('postman.run', { endpoints: plan.endpoints, mocks: plan.mocks })}
        </Button>
      </div>
    </section>
  )
}

/** Rows drawn at most; the rest are imported with their defaults (a huge table would freeze the page). */
const MAX_ROWS = 500

const EMPTY_PLAN = (fields: IntegrationFields): Plan => ({
  integration: fields,
  addsToExisting: false,
  rows: [],
  bundle: { integrations: [], catalog: [], mocks: [], oidcIdentities: [] },
  endpoints: 0,
  mocks: 0,
})

/** The plan, or why it could not be made: rendering never throws on an odd collection. */
function safePlan(
  collection: PostmanCollection,
  fields: IntegrationFields,
  stored: Integration | undefined,
  endpoints: Endpoint[] | undefined,
  choices: Record<string, RowChoice>,
): { plan: Plan; error?: string } {
  try {
    const existing = stored ? { integration: stored, endpointKeys: (endpoints ?? []).map((e) => e.key) } : undefined
    return { plan: planPostman(collection, { integration: fields, existing, choices }) }
  } catch (error) {
    return { plan: EMPTY_PLAN(fields), error: error instanceof Error ? error.message : String(error) }
  }
}

function bundleText(bundle: Plan['bundle']): string | undefined {
  try {
    return JSON.stringify(bundle)
  } catch {
    return undefined
  }
}

/** The request body's size, or undefined when it cannot be serialised. */
function bundleBytes(bundle: Plan['bundle']): number | undefined {
  const text = bundleText(bundle)
  return text === undefined ? undefined : new TextEncoder().encode(text).length
}

function RequestRow({ row, onChoose }: { row: PlanRow; onChoose: (patch: RowChoice) => void }) {
  const t = useT()
  const examples = row.request.examples
  const skipping = row.action === 'skip'
  const actions: { value: RowAction; label: string }[] = row.conflict
    ? [
        { value: 'create', label: row.action === 'create' ? t('postman.actionCreate', { key: row.key }) : t('postman.actionCreatePlain') },
        { value: 'overwrite', label: t('postman.actionOverwrite') },
        { value: 'skip', label: t('postman.actionSkip') },
      ]
    : [
        { value: 'create', label: t('postman.actionImport') },
        { value: 'skip', label: t('postman.actionSkip') },
      ]
  const status: MessageKey = row.conflict ? 'postman.statusConflict' : 'postman.statusNew'
  return (
    <TableRow className={cn('hover:bg-surface-2', skipping && 'opacity-60')}>
      <TableCell>
        <MethodBadge method={row.method} />
      </TableCell>
      <TableCell className="max-w-80 min-w-40 font-mono text-xs [overflow-wrap:anywhere] whitespace-normal" dir="ltr">
        {row.url}
      </TableCell>
      <TableCell className="max-w-64 min-w-36 whitespace-normal">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm">{row.name}</span>
          <span className="font-mono text-[11px] text-muted-foreground" dir="ltr">
            {row.proposedKey}
            {row.key !== row.proposedKey && <span className="text-hazard-fg"> · {t('postman.renamed', { key: row.key })}</span>}
          </span>
          {row.request.folder.length > 0 && <span className="text-[10px] text-muted-foreground">{row.request.folder.join(' / ')}</span>}
        </div>
      </TableCell>
      <TableCell className="text-center tabular-nums">{examples.length}</TableCell>
      <TableCell className="text-center tabular-nums">{skipping ? 0 : row.mocks}</TableCell>
      <TableCell className="min-w-44">
        {examples.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t('postman.noExamples')}</span>
        ) : examples.length === 1 ? (
          <span className="flex items-center gap-1.5 text-xs">
            <StatusBadge status={examples[0].status} />
            {examples[0].name}
          </span>
        ) : (
          <Select value={row.defaultExample} onValueChange={(defaultExample) => onChoose({ defaultExample })} disabled={skipping}>
            <SelectTrigger size="sm" className="w-full" aria-label={t('postman.defaultFor', { name: row.name })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {examples.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="font-mono text-[11px] tabular-nums">{e.status}</span> {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
      <TableCell className="min-w-40">
        <div className="flex flex-col gap-1">
          <span className={cn('text-[10px] tracking-[0.14em] uppercase', row.conflict ? 'text-hazard-fg' : 'text-signal-fg')}>{t(status)}</span>
          <Select value={row.action} onValueChange={(action) => onChoose({ action: action as RowAction })}>
            <SelectTrigger size="sm" className="w-full" aria-label={t('postman.actionFor', { name: row.name })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actions.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </TableCell>
    </TableRow>
  )
}
