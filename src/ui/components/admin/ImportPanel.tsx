import { useId, useRef, useState } from 'react'
import { AlertCircleIcon, CheckCircle2Icon, FileJsonIcon, UploadIcon } from 'lucide-react'
import type { ImportReport } from '@/server/bundle/importer'
import { useImport } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Spinner } from '@/ui/components/ui/spinner'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const BUNDLE_KEYS = ['integrations', 'catalog', 'mocks', 'oidcIdentities'] as const

export type ImportSummary = { integrations: number; endpoints: number; mocks: number; oidcIdentities: number }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)

/** Mirrors the server's accepted shapes: a bundle, a WireMock export, a single stub or an array of stubs. */
export function summarize(json: unknown): ImportSummary | null {
  if (Array.isArray(json)) return { integrations: 0, endpoints: 0, mocks: json.length, oidcIdentities: 0 }
  if (!isObject(json)) return null
  if (BUNDLE_KEYS.some((k) => k in json)) {
    return { integrations: count(json.integrations), endpoints: count(json.catalog), mocks: count(json.mocks), oidcIdentities: count(json.oidcIdentities) }
  }
  if ('mappings' in json) return { integrations: 0, endpoints: 0, mocks: count(json.mappings), oidcIdentities: 0 }
  if (isObject(json.request) && isObject(json.response)) return { integrations: 0, endpoints: 0, mocks: 1, oidcIdentities: 0 }
  return null
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

type Loaded = { name: string; bundle: unknown; summary: ImportSummary }

export function ImportPanel() {
  const t = useT()
  // Prune would delete stubs from the user's own WireMock: not offered in WireMock-only mode.
  const wiremockOnly = useWireMockOnly()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const run = useImport()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [prune, setPrune] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [dragging, setDragging] = useState(false)

  const reset = () => {
    setLoaded(null)
    setReport(null)
    setFileError(null)
    setPrune(false)
    run.reset()
    if (inputRef.current) inputRef.current.value = ''
  }

  const choose = async (file: File | undefined) => {
    if (!file) return
    setLoaded(null)
    setReport(null)
    setFileError(null)
    run.reset()
    // Checked before reading anything: the server's 10 MB limit and its JSON-only body.
    if (!file.name.toLowerCase().endsWith('.json')) return setFileError(t('import.notJson', { name: file.name }))
    if (file.size > MAX_IMPORT_BYTES) return setFileError(t('import.tooLarge', { name: file.name, size: (file.size / 1024 / 1024).toFixed(1) }))
    let text: string
    try {
      text = await readText(file)
    } catch {
      return setFileError(t('import.readFailed', { name: file.name }))
    }
    let bundle: unknown
    try {
      bundle = JSON.parse(text)
    } catch (error) {
      return setFileError(t('import.invalidJson', { name: file.name, message: error instanceof Error ? error.message : '' }))
    }
    const summary = summarize(bundle)
    if (!summary) return setFileError(t('import.unrecognised', { name: file.name }))
    setLoaded({ name: file.name, bundle, summary })
  }

  const submit = async () => {
    if (!loaded) return
    try {
      setReport(await run.mutateAsync({ bundle: loaded.bundle, prune }))
    } catch {
      // shown from run.error
    }
  }

  if (report) return <ReportCard report={report} name={loaded?.name} onAgain={reset} />

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void choose(e.dataTransfer.files[0])
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
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label={t('import.choose')}
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
          <FileJsonIcon data-icon="inline-start" />
          {t(loaded ? 'import.change' : 'import.choose')}
        </Button>
      </div>

      {fileError && (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon />
          <AlertDescription>{fileError}</AlertDescription>
        </Alert>
      )}

      {loaded && (
        <section aria-labelledby={`${inputId}-summary`} className="glow-border flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
          <h2 id={`${inputId}-summary`} className="font-mono text-xs text-muted-foreground">
            {t('import.summaryTitle', { name: loaded.name })}
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('import.summaryIntegrations')} value={loaded.summary.integrations} />
            <Stat label={t('import.summaryEndpoints')} value={loaded.summary.endpoints} />
            <Stat label={t('import.summaryMocks')} value={loaded.summary.mocks} />
            {loaded.summary.oidcIdentities > 0 && <Stat label={t('import.summaryIdentities')} value={loaded.summary.oidcIdentities} />}
          </dl>
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
            <Button onClick={() => void submit()} disabled={run.isPending}>
              {run.isPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              {t(run.isPending ? 'import.running' : 'import.run')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{label}</dt>
      <dd className="font-display text-3xl font-bold tabular-nums">{value}</dd>
    </div>
  )
}

function ReportCard({ report, name, onAgain }: { report: ImportReport; name?: string; onAgain: () => void }) {
  const t = useT()
  return (
    <section aria-label={t('import.reportTitle')} className="glow-border flex max-w-2xl flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium text-signal-fg">
        <CheckCircle2Icon aria-hidden className="size-4" />
        {t('import.reportTitle')}
        {name && <span className="font-mono text-xs font-normal text-muted-foreground">{name}</span>}
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
      <div>
        <Button variant="outline" onClick={onAgain}>
          {t('import.reportAgain')}
        </Button>
      </div>
    </section>
  )
}
