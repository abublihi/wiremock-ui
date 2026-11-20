import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, EyeIcon, SaveIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { type BuiltStub, useCreateCatalogMock, usePreviewMock, useUpdateMock } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet'
import { Spinner } from '@/ui/components/ui/spinner'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import { type SimpleForm, emptyForm, exampleFor, generatedName, toSimpleInput } from '@/ui/lib/editor-sync'
import {
  FAULT_OPTIONS,
  PRESET_LABEL,
  SLOW_MAX_SECONDS,
  SLOW_MIN_SECONDS,
  type Preset,
  presetToStatus,
  visiblePresets,
} from '@/ui/lib/presets'
import { cn } from '@/ui/lib/utils'
import { CodeEditor } from './CodeEditor'
import { Eyebrow } from './EditorShell'
import { keyLabel } from './EndpointPicker'

type FieldName = 'keyValue' | 'status' | 'body' | 'delay' | 'fault' | 'name'
type Errors = Partial<Record<FieldName, string>>

const SERVER_FIELD = new Map<string, FieldName>([
  ['keyValue', 'keyValue'],
  ['isDefault', 'keyValue'],
  ['status', 'status'],
  ['body', 'body'],
  ['delayMs', 'delay'],
  ['fault', 'fault'],
  ['name', 'name'],
])

/** The form field a server validation message names ("keyValue is required" → keyValue), if any. */
function fieldOf(message: string): FieldName | undefined {
  if (message === 'body must be an object') return undefined // about the request, not the response body
  const word = /^(\w+)\b/.exec(message)?.[1]
  return word ? SERVER_FIELD.get(word) : undefined
}

const NO_FAULT = 'none'
const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'

/**
 * The catalog-first Simple editor: answers for one endpoint, built by the server's builder (preview/create),
 * or saved over an existing mock with `PUT { stub, version }` when `mock` is given.
 * `onChange` reports every form change; `onSaved` takes over after a save (default: open the mock);
 * `onConflict` takes over a 409 (default: an inline message).
 */
export function SimpleEditor({
  integration,
  endpoint,
  initial,
  mock,
  onChange,
  onSaved,
  onConflict,
}: {
  integration: Integration
  endpoint: Endpoint
  initial?: SimpleForm
  mock?: StubMapping
  onChange?: (form: SimpleForm) => void
  onSaved?: (stub: StubMapping) => void | Promise<void>
  onConflict?: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`

  const [form, setForm] = useState<SimpleForm>(() => initial ?? emptyForm(endpoint))
  // An existing mock's body is the user's; a new form's body follows the example until the user types.
  const [bodyTouched, setBodyTouched] = useState(Boolean(initial))
  // The status whose catalog example is in the body (shown in the "prefilled from" caption).
  const [exampleStatus, setExampleStatus] = useState(form.status)
  const [customText, setCustomText] = useState(String(form.status))
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<{ title: string; message: string } | null>(null)
  const [preview, setPreview] = useState<BuiltStub | null>(null)

  const previewMock = usePreviewMock()
  const createMock = useCreateCatalogMock()
  const updateMock = useUpdateMock()
  const [saving, setSaving] = useState(false)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => onChangeRef.current?.(form), [form])

  const presets = visiblePresets(endpoint.allowedStatuses)
  const covered = new Set(presets.map((p) => presetToStatus(p).status))
  // Also shown whenever the form is on a custom status, so a stored one always has a selected item.
  const showCustom =
    form.preset === 'custom' || endpoint.allowedStatuses.length === 0 || endpoint.allowedStatuses.some((s) => !covered.has(s))
  const broken = form.fault !== ''
  const timeout = !broken && form.preset === 'timeout'

  // Client-side checks for the two number inputs; everything else is the server builder's call.
  const clientErrors: Errors = {}
  if (!broken && form.preset === 'custom') {
    const n = Number(customText)
    if (!Number.isInteger(n) || n < 100 || n > 599) clientErrors.status = t('editor.statusRange')
    else if (endpoint.allowedStatuses.length > 0 && !endpoint.allowedStatuses.includes(n))
      clientErrors.status = t('editor.statusNotAllowed', { allowed: endpoint.allowedStatuses.join(', ') })
  }
  if (form.slow && !timeout) {
    const s = form.delaySeconds
    if (!Number.isInteger(s) || s < SLOW_MIN_SECONDS || s > SLOW_MAX_SECONDS) clientErrors.delay = t('editor.slowRange')
  }
  const errors: Errors = { ...serverErrors, ...clientErrors }

  const update = (patch: Partial<SimpleForm>, clears: FieldName[] = []) => {
    setForm((f) => ({ ...f, ...patch }))
    if (clears.some((c) => serverErrors[c])) setServerErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clears.includes(k as FieldName))))
  }
  /** A preset always swaps in its example (or none); a typed custom status only when the catalog has one. */
  const setStatus = (preset: Preset, status: number, keepWithoutExample = false) => {
    const example = exampleFor(endpoint, status)
    const refill = !bodyTouched && (example !== '' || !keepWithoutExample)
    if (refill) setExampleStatus(status)
    update({ preset, status, ...(refill ? { body: example } : {}) }, ['status', 'body'])
  }
  const onPreset = (value: string) => {
    if (!value) return // the toggle group allows deselecting; a status is always chosen
    const preset = value as Preset
    if (preset === 'custom') {
      setCustomText(String(form.status))
      update({ preset }, ['status'])
    } else setStatus(preset, presetToStatus(preset).status)
  }
  const onCustom = (text: string) => {
    setCustomText(text)
    const n = Number(text)
    if (text !== '' && Number.isInteger(n)) setStatus('custom', n, true)
  }

  const handleError = (error: unknown, title: string) => {
    if (error instanceof ApiError && error.status === 409) {
      if (onConflict) return onConflict()
      setFormError({ title: t('editor.saveFailed'), message: t('editor.conflict') })
      return
    }
    const message = error instanceof Error && error.message ? error.message : t('error.generic')
    const field = error instanceof ApiError && error.status === 400 ? fieldOf(message) : undefined
    if (field) setServerErrors({ [field]: message })
    else setFormError({ title, message })
  }
  const args = () => ({ integration: integration.key, endpoint: endpoint.key, input: toSimpleInput(form) })
  const blocked = Object.keys(clientErrors).length > 0
  const reset = () => {
    setServerErrors({})
    setFormError(null)
  }

  const onPreview = async () => {
    reset()
    try {
      setPreview(await previewMock.mutateAsync(args()))
    } catch (error) {
      handleError(error, t('editor.previewFailed'))
    }
  }

  const onSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (blocked || saving) return
    reset()
    setSaving(true)
    try {
      let saved: StubMapping
      if (mock) {
        // The server's builder stays the single source of the stub; the PUT carries the version we opened.
        const stub = await previewMock.mutateAsync(args())
        saved = await updateMock.mutateAsync({ id: mock.id, stub, version: mock.metadata?.wiremockUi?.version ?? 0 })
      } else saved = await createMock.mutateAsync(args())
      toast.success(t('editor.saved'))
      if (onSaved) await onSaved(saved)
      else await navigate({ to: '/mocks/$id', params: { id: saved.id } })
    } catch (error) {
      handleError(error, t('editor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const described = (field: FieldName, ...extra: (string | false)[]) =>
    [...extra, errors[field] && id(`${field}-error`)].filter(Boolean).join(' ') || undefined
  const fieldError = (field: FieldName) =>
    errors[field] ? <FieldError id={id(`${field}-error`)}>{errors[field]}</FieldError> : null

  const bodyLanguage = endpoint.contentType === 'json' || endpoint.contentType === 'xml' ? endpoint.contentType : null
  const namePlaceholder =
    form.isDefault || form.keyValue.trim() ? generatedName(endpoint, form) : `${endpoint.name} — …`

  return (
    <form noValidate onSubmit={onSave} className="flex flex-col gap-4">
      {formError && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{formError.title}</AlertTitle>
          <AlertDescription>{formError.message}</AlertDescription>
        </Alert>
      )}

      <Section title={t('editor.section.match')}>
        <Field orientation="horizontal">
          <Switch
            id={id('default')}
            checked={form.isDefault}
            disabled={!endpoint.lookup}
            onCheckedChange={(isDefault) => update({ isDefault }, ['keyValue'])}
          />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor={id('default')}>{t('editor.default')}</FieldLabel>
            <FieldDescription className="text-xs">
              {endpoint.lookup ? t('editor.defaultHint') : t('editor.noLookup')}
            </FieldDescription>
          </div>
        </Field>
        {!form.isDefault && endpoint.lookup && (
          <Field data-invalid={Boolean(errors.keyValue)}>
            <FieldLabel htmlFor={id('key')}>{keyLabel(t, endpoint)}</FieldLabel>
            <Input
              id={id('key')}
              dir="ltr"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('editor.keyPlaceholder')}
              value={form.keyValue}
              aria-invalid={Boolean(errors.keyValue)}
              aria-describedby={described('keyValue')}
              onChange={(e) => update({ keyValue: e.target.value }, ['keyValue'])}
            />
            {fieldError('keyValue')}
          </Field>
        )}
      </Section>

      <Section title={t('editor.section.respond')}>
        <FieldSet disabled={broken} className="gap-2">
          <FieldLegend variant="label" id={id('status-label')}>
            {t('editor.status')}
          </FieldLegend>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-labelledby={id('status-label')}
            aria-describedby={described('status', timeout && id('timeout-hint'))}
            disabled={broken}
            value={form.preset}
            onValueChange={onPreset}
            className="flex-wrap"
          >
            {presets.map((preset) => (
              <ToggleGroupItem
                key={preset}
                value={preset}
                aria-label={`${t(PRESET_LABEL[preset])} ${presetToStatus(preset).status}`}
                className={cn('gap-1.5', ON)}
              >
                {t(PRESET_LABEL[preset])}
                <span aria-hidden className="font-mono text-[10px] opacity-60">
                  {presetToStatus(preset).status}
                </span>
              </ToggleGroupItem>
            ))}
            {showCustom && (
              <ToggleGroupItem value="custom" aria-label={t(PRESET_LABEL.custom)} className={ON}>
                {t(PRESET_LABEL.custom)}
              </ToggleGroupItem>
            )}
          </ToggleGroup>
          {timeout && (
            <FieldDescription id={id('timeout-hint')} className="text-xs">
              {t('editor.timeoutHint')}
            </FieldDescription>
          )}
          {form.preset === 'custom' && !broken && (
            <Field data-invalid={Boolean(errors.status)} className="max-w-48">
              <FieldLabel htmlFor={id('custom')} className="sr-only">
                {t('editor.customStatus')}
              </FieldLabel>
              <Input
                id={id('custom')}
                type="number"
                inputMode="numeric"
                min={100}
                max={599}
                className="font-mono"
                value={customText}
                aria-invalid={Boolean(errors.status)}
                aria-describedby={described('status')}
                onChange={(e) => onCustom(e.target.value)}
              />
            </Field>
          )}
          {fieldError('status')}
        </FieldSet>

        <Field data-invalid={Boolean(errors.body)}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {bodyLanguage ? (
              <span id={id('body-label')} className="text-sm font-medium">
                {t('editor.body')}
              </span>
            ) : (
              <FieldLabel htmlFor={id('body')}>{t('editor.body')}</FieldLabel>
            )}
            {!broken && !bodyTouched && form.body !== '' && (
              <span className="text-[11px] text-muted-foreground">{t('editor.bodyFromExample', { status: exampleStatus })}</span>
            )}
          </div>
          {bodyLanguage ? (
            <CodeEditor
              value={broken ? '' : form.body}
              language={bodyLanguage}
              label={t('editor.body')}
              readOnly={broken}
              invalid={Boolean(errors.body)}
              describedBy={described('body', broken && id('body-hint'))}
              maxHeight="28rem"
              onChange={(body) => {
                setBodyTouched(true)
                update({ body }, ['body'])
              }}
            />
          ) : (
            <Textarea
              id={id('body')}
              dir="ltr"
              className="min-h-48 font-mono text-xs md:text-xs"
              spellCheck={false}
              disabled={broken}
              value={broken ? '' : form.body}
              aria-invalid={Boolean(errors.body)}
              aria-describedby={described('body', broken && id('body-hint'))}
              onChange={(e) => {
                setBodyTouched(true)
                update({ body: e.target.value }, ['body'])
              }}
            />
          )}
          {broken && (
            <FieldDescription id={id('body-hint')} className="text-xs">
              {t('editor.bodyDisabled')}
            </FieldDescription>
          )}
          {fieldError('body')}
        </Field>
      </Section>

      <Section title={t('editor.section.behaviour')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.delay)}>
            <div className="flex items-center gap-3">
              <Switch
                id={id('slow')}
                checked={form.slow && !timeout}
                disabled={timeout}
                aria-describedby={timeout ? id('slow-hint') : undefined}
                onCheckedChange={(slow) => update({ slow }, ['delay'])}
              />
              <FieldLabel htmlFor={id('slow')}>{t('editor.slow')}</FieldLabel>
            </div>
            {timeout && (
              <FieldDescription id={id('slow-hint')} className="text-xs">
                {t('editor.slowTimeout')}
              </FieldDescription>
            )}
            {form.slow && !timeout && (
              <div className="flex items-center gap-2">
                <Input
                  id={id('seconds')}
                  type="number"
                  inputMode="numeric"
                  min={SLOW_MIN_SECONDS}
                  max={SLOW_MAX_SECONDS}
                  className="w-24 font-mono"
                  aria-label={t('editor.slowSeconds')}
                  aria-invalid={Boolean(errors.delay)}
                  aria-describedby={described('delay', id('seconds-hint'))}
                  value={Number.isNaN(form.delaySeconds) ? '' : form.delaySeconds}
                  onChange={(e) => update({ delaySeconds: e.target.value === '' ? Number.NaN : Number(e.target.value) }, ['delay'])}
                />
                <span id={id('seconds-hint')} className="text-xs text-muted-foreground">
                  s · {t('editor.slowRange')}
                </span>
              </div>
            )}
            {fieldError('delay')}
          </Field>

          <Field data-invalid={Boolean(errors.fault)}>
            <FieldLabel htmlFor={id('fault')}>{t('editor.fault')}</FieldLabel>
            <Select value={form.fault || NO_FAULT} onValueChange={(v) => update({ fault: v === NO_FAULT ? '' : (v as SimpleForm['fault']) }, ['fault', 'status', 'body'])}>
              <SelectTrigger id={id('fault')} className="w-full" aria-invalid={Boolean(errors.fault)} aria-describedby={described('fault')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FAULT}>{t('editor.fault.none')}</SelectItem>
                {FAULT_OPTIONS.map((fault) => (
                  <SelectItem key={fault.value} value={fault.value}>
                    {t(fault.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError('fault')}
          </Field>
        </div>
      </Section>

      <Section title={t('editor.section.label')}>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor={id('name')}>
            {t('editor.name')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
          </FieldLabel>
          <Input
            id={id('name')}
            value={form.name}
            placeholder={namePlaceholder}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={described('name')}
            onChange={(e) => update({ name: e.target.value }, ['name'])}
          />
          {fieldError('name')}
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/85 px-1 py-3 backdrop-blur">
        <Button type="button" variant="outline" disabled={previewMock.isPending || saving || blocked} onClick={() => void onPreview()}>
          {previewMock.isPending && !saving ? <Spinner data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
          {t('editor.preview')}
        </Button>
        <Button type="submit" disabled={saving || blocked}>
          {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {saving ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>

      <Sheet open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <SheetContent className="glass-panel flex w-full flex-col gap-0 sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t('editor.previewTitle')}</SheetTitle>
            <SheetDescription className="text-xs">{t('editor.previewDescription')}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            {preview && (
              <CodeEditor value={JSON.stringify(preview, null, 2)} language="json" label={t('editor.previewTitle')} readOnly />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glow-border flex flex-col gap-4 rounded-md border border-line bg-surface p-4 sm:p-5">
      <Eyebrow>{title}</Eyebrow>
      <FieldGroup className="gap-5">{children}</FieldGroup>
    </section>
  )
}
