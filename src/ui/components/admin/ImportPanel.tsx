import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircleIcon, CheckCircle2Icon, FileJsonIcon, FolderOpenIcon, UploadIcon, XIcon } from 'lucide-react'
import type { ImportReport } from '@/server/bundle/importer'
import { useImport } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Spinner } from '@/ui/components/ui/spinner'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'
import {
  MAX_IMPORT_BYTES,
  loadPicked,
  megabytes,
  mergeResults,
  pickedFromDrop,
  pickedFromInput,
  type FileResult,
  type ImportSummary,
  type PickedFile,
} from '@/ui/lib/import-files'
import type { IntegrationFields } from '@/ui/lib/postman'
import { cn } from '@/ui/lib/utils'
import { PostmanPreview } from './PostmanPreview'

type Loaded = { label: string; results: FileResult[]; skipped: string[] }

export function ImportPanel() {
  const t = useT()
  // Prune would delete stubs from the user's own WireMock: not offered in WireMock-only mode.
  const wiremockOnly = useWireMockOnly()
  const inputId = useId()
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const run = useImport()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [reading, setReading] = useState(false)
  const [prune, setPrune] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)
  /** The integration a Postman import went into (for the report's link). */
  const [postmanTarget, setPostmanTarget] = useState<IntegrationFields | null>(null)
  const [dragging, setDragging] = useState(false)

  // React has no prop for it: the folder picker needs the (non-standard, widely supported) webkitdirectory attribute.
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
  }, [report])

  const clearInputs = () => {
    if (filesRef.current) filesRef.current.value = ''
    if (folderRef.current) folderRef.current.value = ''
  }
  const reset = () => {
    setLoaded(null)
    setReport(null)
    setPostmanTarget(null)
    setPrune(false)
    run.reset()
    clearInputs()
  }

  const choose = async (picked: PickedFile[], folder: (p: PickedFile) => boolean) => {
    if (picked.length === 0) return
    setLoaded(null)
    setReport(null)
    run.reset()
    setReading(true)
    try {
      const { results, skipped } = await loadPicked(picked, { folder })
      const label = results.length === 1 ? results[0].path : t('import.filesLabel', { count: results.length })
      setLoaded({ label, results, skipped })
    } catch (error) {
      // Anything unexpected while reading becomes one error row instead of an unhandled rejection.
      const path = picked.length === 1 ? picked[0].path : t('import.filesLabel', { count: picked.length })
      const message = error instanceof Error ? error.message : String(error)
      setLoaded({ label: path, results: [{ path, ok: false, error: { key: 'import.fileShape', params: { message } } }], skipped: [] })
    } finally {
      setReading(false)
    }
  }

  const remove = (path: string) =>
    setLoaded((current) => {
      if (!current) return current
      const results = current.results.filter((r) => r.path !== path)
      if (results.length === 0) {
        clearInputs()
        return null
      }
      return { ...current, results, label: results.length === 1 ? results[0].path : t('import.filesLabel', { count: results.length }) }
    })

  const merged = useMemo(() => (loaded ? mergeResults(loaded.results) : null), [loaded])
  const failed = loaded?.results.filter((r) => !r.ok).length ?? 0
  // A Postman collection has its own preview; it is imported on its own, not merged with other files.
  const postmanCount = loaded?.results.filter((r) => r.ok && r.postman).length ?? 0
  const single = loaded?.results.length === 1 ? loaded.results[0] : undefined
  const postman = single?.ok ? single.postman : undefined
  const mixedPostman = postmanCount > 0 && !postman
  const tooBig = merged !== null && merged.bytes > MAX_IMPORT_BYTES
  const empty = loaded !== null && failed === 0 && loaded.results.length === 0

  const submit = async () => {
    if (!merged || failed > 0 || tooBig || mixedPostman) return
    try {
      setReport(await run.mutateAsync({ bundle: merged.bundle, prune }))
    } catch {
      // shown from run.error
    }
  }

  if (report) return <ReportCard report={report} name={loaded?.label} integration={postmanTarget ?? undefined} onAgain={reset} />

  return (
    <div className={cn('flex flex-col gap-4', postman ? 'max-w-6xl' : 'max-w-2xl')}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void pickedFromDrop(e.dataTransfer)
            .then(({ picked, fromFolder }) => choose(picked, (p) => fromFolder.has(p.path)))
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error)
              setLoaded({ label: '', results: [{ path: '', ok: false, error: { key: 'import.fileShape', params: { message } } }], skipped: [] })
            })
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-md border border-dashed border-line bg-surface px-4 py-10 text-center transition-colors',
          dragging && 'border-signal bg-signal/5',
        )}
      >
        <UploadIcon aria-hidden className="size-6 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{t('import.drop')}</p>
          <p className="text-xs text-muted-foreground">{t('import.dropHint')}</p>
        </div>
        <input
          ref={filesRef}
          type="file"
          multiple
          accept=".json,.zip,application/json,application/zip"
          className="sr-only"
          aria-label={t('import.choose')}
          onChange={(e) => void choose(pickedFromInput(e.target.files ?? []), () => false)}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          className="sr-only"
          aria-label={t('import.chooseFolder')}
          onChange={(e) => void choose(pickedFromInput(e.target.files ?? []), () => true)}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" disabled={reading} onClick={() => filesRef.current?.click()}>
            <FileJsonIcon data-icon="inline-start" />
            {t('import.choose')}
          </Button>
          <Button type="button" variant="outline" disabled={reading} onClick={() => folderRef.current?.click()}>
            <FolderOpenIcon data-icon="inline-start" />
            {t('import.chooseFolder')}
          </Button>
        </div>
        {reading && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            {t('import.reading')}
          </p>
        )}
      </div>

      {loaded && postman && single && (
        <PostmanPreview
          key={single.path}
          collection={postman}
          fileName={single.path}
          onCancel={reset}
          onImported={(r, integration) => {
            setPostmanTarget(integration)
            setReport(r)
          }}
        />
      )}

      {loaded && merged && !postman && (
        <section aria-labelledby={`${inputId}-summary`} className="glow-border flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
          <h2 id={`${inputId}-summary`} className="font-mono text-xs break-all text-muted-foreground">
            {t('import.summaryTitle', { name: loaded.label })}
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('import.summaryIntegrations')} value={merged.summary.integrations} />
            <Stat label={t('import.summaryEndpoints')} value={merged.summary.endpoints} />
            <Stat label={t('import.summaryMocks')} value={merged.summary.mocks} />
            {merged.summary.oidcIdentities > 0 && <Stat label={t('import.summaryIdentities')} value={merged.summary.oidcIdentities} />}
          </dl>

          <ul aria-label={t('import.filesList')} className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-md border border-line">
            {loaded.results.map((r) => (
              <li key={r.path} className="flex items-start gap-2 px-3 py-2 text-xs">
                {r.ok ? (
                  <CheckCircle2Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-signal-fg" />
                ) : (
                  <AlertCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-mismatch" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span data-path dir="ltr" className="font-mono break-all">{r.path}</span>
                  {r.ok && r.postman ? (
                    <span className="text-muted-foreground">{t('import.postmanRow', { count: r.postman.requests.length })}</span>
                  ) : r.ok ? (
                    <span className="text-muted-foreground">{countsText(t, r.summary)}</span>
                  ) : (
                    <span className="break-words text-mismatch">{t(r.error.key, r.error.params)}</span>
                  )}
                </div>
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t('import.removeFile', { name: r.path })} onClick={() => remove(r.path)}>
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>

          {loaded.skipped.length > 0 && (
            <p className="text-[11px] break-all text-hazard-fg">
              {t(loaded.skipped.length === 1 ? 'import.skippedEntriesOne' : 'import.skippedEntries', { count: loaded.skipped.length, names: loaded.skipped.join(', ') })}
            </p>
          )}
          {failed > 0 && (
            <Alert variant="destructive" role="alert">
              <AlertCircleIcon />
              <AlertDescription>{t('import.fixErrors')}</AlertDescription>
            </Alert>
          )}
          {mixedPostman && (
            <Alert variant="destructive" role="alert">
              <AlertCircleIcon />
              <AlertDescription>{t('import.postmanAlone')}</AlertDescription>
            </Alert>
          )}
          {failed === 0 && tooBig && (
            <Alert variant="destructive" role="alert">
              <AlertCircleIcon />
              <AlertDescription>{t('import.mergedTooLarge', { size: megabytes(merged.bytes) })}</AlertDescription>
            </Alert>
          )}
          {empty && <p className="text-xs text-muted-foreground">{t('import.nothingFound')}</p>}

          {!wiremockOnly && (
            <div className="flex items-start gap-2">
              <input
                id={`${inputId}-prune`}
                type="checkbox"
                checked={prune}
                onChange={(e) => setPrune(e.target.checked)}
                aria-describedby={`${inputId}-prune-hint`}
                className="mt-0.5 size-4 shrink-0 accent-[var(--signal)]"
              />
              <div className="flex flex-col gap-0.5">
                <label htmlFor={`${inputId}-prune`} className="cursor-pointer text-[11px]">
                  {t('import.prune')}
                </label>
                <p id={`${inputId}-prune-hint`} className="text-[10px] text-muted-foreground">
                  {t('import.pruneHint')}
                </p>
              </div>
            </div>
          )}
          {run.isError && (
            <Alert variant="destructive" role="alert">
              <AlertCircleIcon />
              <AlertTitle>{t('import.failed')}</AlertTitle>
              <AlertDescription>{run.error.message || t('error.generic')}</AlertDescription>
            </Alert>
          )}
          <div>
            <Button onClick={() => void submit()} disabled={run.isPending || failed > 0 || tooBig || empty || mixedPostman}>
              {run.isPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              {t(run.isPending ? 'import.running' : 'import.run')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function countsText(t: ReturnType<typeof useT>, s: ImportSummary): string {
  const parts: string[] = []
  if (s.integrations > 0) parts.push(t(s.integrations === 1 ? 'import.countIntegration' : 'import.countIntegrations', { count: s.integrations }))
  if (s.endpoints > 0) parts.push(t(s.endpoints === 1 ? 'import.countEndpoint' : 'import.countEndpoints', { count: s.endpoints }))
  parts.push(t(s.mocks === 1 ? 'import.countMock' : 'import.countMocks', { count: s.mocks }))
  return parts.join(' · ')
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{label}</dt>
      <dd className="font-display text-3xl font-bold tabular-nums">{value}</dd>
    </div>
  )
}

function ReportCard({ report, name, integration, onAgain }: { report: ImportReport; name?: string; integration?: IntegrationFields; onAgain: () => void }) {
  const t = useT()
  return (
    <section aria-label={t('import.reportTitle')} className="glow-border flex max-w-2xl flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium text-signal-fg">
        <CheckCircle2Icon aria-hidden className="size-4" />
        {t('import.reportTitle')}
        {name && <span className="font-mono text-xs font-normal break-all text-muted-foreground">{name}</span>}
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('import.reportCreated')} value={report.created} />
        <Stat label={t('import.reportUpdated')} value={report.updated} />
        <Stat label={t('import.reportUnchanged')} value={report.unchanged} />
        <Stat label={t('import.reportPruned')} value={report.pruned} />
        <Stat label={t('import.reportIntegrations')} value={report.integrations} />
        <Stat label={t('import.reportEndpoints')} value={report.endpoints} />
        <Stat label={t('import.reportIdentities')} value={report.ignoredOidcIdentities} />
      </dl>
      {report.skipped.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] tracking-[0.14em] text-hazard-fg uppercase">{t('import.reportSkipped', { count: report.skipped.length })}</h3>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {report.skipped.map((s, i) => (
              <li key={`${s.id}-${i}`} className="flex flex-col gap-0.5 px-3 py-2 text-xs sm:flex-row sm:gap-3">
                <span dir="ltr" className="font-mono break-all">{s.id}</span>
                <span className="text-muted-foreground">{s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {integration && (
          <Button asChild>
            <Link to="/catalog/$key" params={{ key: integration.key }}>
              {t('import.reportOpenIntegration', { name: integration.name })}
            </Link>
          </Button>
        )}
        <Button variant="outline" onClick={onAgain}>
          {t('import.reportAgain')}
        </Button>
      </div>
    </section>
  )
}
