import { useId, useMemo, useState } from 'react'
import { AlertCircleIcon, SaveIcon } from 'lucide-react'
import type { StubMapping } from '@/server/wiremock/types'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError } from '@/ui/components/ui/field'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT } from '@/ui/i18n'
import { type EditableStub, parseStubJson } from '@/ui/lib/editor-sync'
import { isValidDate, relativeTime } from '@/ui/lib/time'
import { applyBodyFile, type BodyFile } from '@/ui/lib/body-file'
import { BodyFileButton } from './BodyFileButton'
import { CodeEditor } from './CodeEditor'
import { Eyebrow } from './EditorShell'

/**
 * Advanced mode: the whole stub as JSON, minus the fields the server owns (shown read-only above it).
 * Save stays disabled while the JSON does not parse to an object.
 */
export function AdvancedEditor({
  text,
  onTextChange,
  mock,
  saving,
  error,
  onSave,
  above,
  saveDisabledReason,
}: {
  text: string
  onTextChange: (text: string) => void
  /** The saved version this draft started from; undefined for a new mock. */
  mock?: StubMapping
  saving: boolean
  error: { title: string; message: string } | null
  onSave: (stub: EditableStub) => void
  /** Shown above the JSON (e.g. which response of a mock with several responses this is). */
  above?: React.ReactNode
  /** Why this JSON can't be saved on its own (Save stays off and says why). */
  saveDisabledReason?: string
}) {
  const t = useT()
  const errorId = useId()
  const parsed = useMemo(() => parseStubJson(text), [text])
  const [fileError, setFileError] = useState<string | null>(null)
  const onBodyFile = (file: BodyFile) => {
    // Read the editor's current text, not a stale parse: the file goes into what is on screen.
    const current = parseStubJson(text)
    if (!current.ok) return setFileError(t('editor.bodyFile.fixJson'))
    onTextChange(JSON.stringify(applyBodyFile(current.value, file, { json: false }), null, 2))
  }
  const problem = parsed.ok
    ? null
    : parsed.reason === 'notObject'
      ? t('editor.jsonNotObject')
      : parsed.line === undefined
        ? parsed.message
        : t('editor.jsonError', { line: parsed.line, column: parsed.column ?? 1, message: parsed.message })

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (parsed.ok && !saving && !saveDisabledReason) onSave(parsed.value)
      }}
    >
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {above}

      <ServerFields mock={mock} />

      <section className="glow-border flex flex-col gap-3 rounded-md border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>{t('editor.json')}</Eyebrow>
          <BodyFileButton onFile={onBodyFile} onError={setFileError} />
        </div>
        {fileError && (
          <p role="alert" className="text-xs text-mismatch">
            {fileError}
          </p>
        )}
        <Field data-invalid={Boolean(problem)}>
          <CodeEditor
            value={text}
            onChange={onTextChange}
            language="json"
            label={t('editor.json')}
            invalid={Boolean(problem)}
            describedBy={problem ? errorId : undefined}
            minHeight="20rem"
            maxHeight="70vh"
          />
          {problem ? (
            <FieldError id={errorId} className="font-mono text-xs">
              {problem}
            </FieldError>
          ) : (
            <FieldDescription className="text-xs">{t('editor.jsonHint')}</FieldDescription>
          )}
        </Field>
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/85 px-1 py-3 backdrop-blur">
        {saveDisabledReason && <span className="text-xs text-muted-foreground">{saveDisabledReason}</span>}
        <Button type="submit" disabled={saving || !parsed.ok || Boolean(saveDisabledReason)}>
          {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {saving ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>
    </form>
  )
}

/** id, owner, version and last update: kept by the server, so shown but never edited. */
function ServerFields({ mock }: { mock?: StubMapping }) {
  const t = useT()
  const meta = mock?.metadata?.wiremockUi
  const rows: [string, React.ReactNode][] = [
    [t('editor.field.id'), mock?.id ?? <span className="text-muted-foreground">{t('editor.field.assigned')}</span>],
  ]
  if (meta) {
    rows.push(
      [t('editor.field.owner'), meta.owner],
      [t('editor.field.version'), String(meta.version)],
      [t('editor.field.updatedBy'), meta.updatedBy || '—'],
      [
        t('editor.field.updated'),
        isValidDate(meta.updatedAt) ? (
          <time dateTime={meta.updatedAt} title={new Date(meta.updatedAt).toLocaleString('en')}>
            {relativeTime(meta.updatedAt)}
          </time>
        ) : (
          '—'
        ),
      ],
    )
  }
  return (
    <section aria-label={t('editor.serverFields')} className="rounded-md border border-dashed border-line bg-surface/60 px-4 py-3">
      <Eyebrow>{t('editor.serverFields')}</Eyebrow>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="min-w-0 font-mono break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
