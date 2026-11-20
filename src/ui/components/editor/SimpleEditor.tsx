import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, EyeIcon, FileIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { type BuiltStub, useCreateCatalogMock, usePreviewMock, useScenarios, useUpdateMock } from '@/ui/api/queries'
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
import {
  type ProxyForm,
  type ScenarioForm,
  type ScenarioSeed,
  type SimpleForm,
  type WebhookForm,
  emptyForm,
  exampleFor,
  generatedName,
  isHttpUrl,
  seedScenario,
  toSimpleInput,
} from '@/ui/lib/editor-sync'
import {
  FAULT_OPTIONS,
  PRESET_LABEL,
  SLOW_MAX_SECONDS,
  MAX_WEBHOOK_DELAY_MS,
  SLOW_MIN_SECONDS,
  type Preset,
  presetToStatus,
  visiblePresets,
} from '@/ui/lib/presets'
import { cn } from '@/ui/lib/utils'
import { type BodyFile, formatSize } from '@/ui/lib/body-file'
import { BodyFileButton } from './BodyFileButton'
import { CodeEditor } from './CodeEditor'
import { Eyebrow } from './EditorShell'
import { keyLabel } from './EndpointPicker'
import { hasUnnamedRow } from './HeaderRows'
import { ProxySection } from './ProxySection'
import { ScenarioSection } from './ScenarioSection'
import { WebhookSection } from './WebhookSection'

type FieldName =
  | 'keyValue'
  | 'status'
  | 'body'
  | 'delay'
  | 'fault'
  | 'name'
  | 'proxyBaseUrl'
  | 'proxyStripPrefix'
  | 'proxyHeaders'
  | 'webhookMethod'
  | 'webhookUrl'
  | 'webhookHeaders'
  | 'webhookBody'
  | 'webhookDelay'
  | 'scenarioName'
  | 'scenarioRequiredState'
  | 'scenarioNewState'
type Errors = Partial<Record<FieldName, string>>

const SERVER_FIELD = new Map<string, FieldName>([
  ['keyValue', 'keyValue'],
  ['isDefault', 'keyValue'],
  ['status', 'status'],
  ['body', 'body'],
  ['delayMs', 'delay'],
  ['fault', 'fault'],
  ['name', 'name'],
  ['proxy.baseUrl', 'proxyBaseUrl'],
  ['proxy.stripPrefix', 'proxyStripPrefix'],
  ['proxy.addHeaders', 'proxyHeaders'],
  ['webhook.method', 'webhookMethod'],
  ['webhook.url', 'webhookUrl'],
  ['webhook.headers', 'webhookHeaders'],
  ['webhook.body', 'webhookBody'],
  ['webhook.delay', 'webhookDelay'],
  ['scenario.name', 'scenarioName'],
  ['scenario.requiredState', 'scenarioRequiredState'],
  ['scenario.newState', 'scenarioNewState'],
])

/**
 * The form field a server validation message names, if any: "keyValue is required" → keyValue,
 * "webhook.delay.lower must …" → webhookDelay (the longest known dotted prefix).
 */
function fieldOf(message: string): FieldName | undefined {
  if (message === 'body must be an object') return undefined // about the request, not the response body
  const parts = (/^([\w.]+)/.exec(message)?.[1] ?? '').split('.')
  for (let n = parts.length; n > 0; n--) {
    const field = SERVER_FIELD.get(parts.slice(0, n).join('.'))
    if (field) return field
  }
  return undefined
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
  scenarioSeed,
  onChange,
  onSaved,
  onConflict,
}: {
  integration: Integration
  endpoint: Endpoint
  initial?: SimpleForm
  mock?: StubMapping
  /** A new mock's scenario (when `initial` is not given): the Scenario section starts on and filled in. */
  scenarioSeed?: ScenarioSeed
  onChange?: (form: SimpleForm) => void
  onSaved?: (stub: StubMapping) => void | Promise<void>
  onConflict?: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`

  const [form, setForm] = useState<SimpleForm>(() => initial ?? seedScenario(emptyForm(endpoint), scenarioSeed))
  // An existing mock's body is the user's; a new form's body follows the example until the user types.
  const [bodyTouched, setBodyTouched] = useState(Boolean(initial))
  // The status whose catalog example is in the body (shown in the "prefilled from" caption).
  const [exampleStatus, setExampleStatus] = useState(form.status)
  const [customText, setCustomText] = useState(String(form.status))
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<{ title: string; message: string } | null>(null)
  const [preview, setPreview] = useState<BuiltStub | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  // Required URLs are only flagged once the user tries to preview or save.
  const [attempted, setAttempted] = useState(false)

  const scenarios = useScenarios({ enabled: form.scenario.enabled, live: true })
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
  const proxied = form.answer === 'proxy'
  const broken = !proxied && form.fault !== ''
  const timeout = !proxied && !broken && form.preset === 'timeout'

  // Client-side checks for the two number inputs; everything else is the server builder's call.
  const clientErrors: Errors = {}
  if (!proxied && !broken && form.preset === 'custom') {
    const n = Number(customText)
    if (!Number.isInteger(n) || n < 100 || n > 599) clientErrors.status = t('editor.statusRange')
    else if (endpoint.allowedStatuses.length > 0 && !endpoint.allowedStatuses.includes(n))
      clientErrors.status = t('editor.statusNotAllowed', { allowed: endpoint.allowedStatuses.join(', ') })
  }
  if (form.slow && !timeout) {
    const s = form.delaySeconds
    if (!Number.isInteger(s) || s < SLOW_MIN_SECONDS || s > SLOW_MAX_SECONDS) clientErrors.delay = t('editor.slowRange')
  }
  if (proxied) {
    const { baseUrl, stripPrefix, addHeaders } = form.proxy
    if ((attempted || baseUrl.trim() !== '') && !isHttpUrl(baseUrl)) clientErrors.proxyBaseUrl = t('editor.proxy.baseUrlInvalid')
    if (stripPrefix.trim() !== '' && !stripPrefix.trim().startsWith('/')) clientErrors.proxyStripPrefix = t('editor.proxy.stripPrefixInvalid')
    if (hasUnnamedRow(addHeaders)) clientErrors.proxyHeaders = t('editor.headers.unnamed')
  }
  if (form.webhook.enabled) {
    const { url, headers, delay, delayMs, lower, upper } = form.webhook
    if ((attempted || url.trim() !== '') && !isHttpUrl(url, { templated: true })) clientErrors.webhookUrl = t('editor.webhook.urlInvalid')
    if (hasUnnamedRow(headers)) clientErrors.webhookHeaders = t('editor.headers.unnamed')
    const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_WEBHOOK_DELAY_MS
    if (delay === 'fixed' && !inRange(delayMs)) clientErrors.webhookDelay = t('editor.webhook.delayRange')
    if (delay === 'uniform') {
      if (!inRange(lower) || !inRange(upper)) clientErrors.webhookDelay = t('editor.webhook.delayRange')
      else if (lower > upper) clientErrors.webhookDelay = t('editor.webhook.delayOrder')
    }
  }
  if (form.scenario.enabled && attempted && form.scenario.name.trim() === '') clientErrors.scenarioName = t('editor.scenario.nameRequired')
  const errors: Errors = { ...serverErrors, ...clientErrors }

  const update = (patch: Partial<SimpleForm>, clears: FieldName[] = []) => {
    setForm((f) => ({ ...f, ...patch }))
    if (clears.some((c) => serverErrors[c])) setServerErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clears.includes(k as FieldName))))
  }
  const clear = (clears: FieldName[]) => {
    if (clears.some((c) => serverErrors[c])) setServerErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clears.includes(k as FieldName))))
  }
  const updateProxy = (patch: Partial<ProxyForm>) => {
    setForm((f) => ({ ...f, proxy: { ...f.proxy, ...patch } }))
    clear(['proxyBaseUrl', 'proxyStripPrefix', 'proxyHeaders'])
  }
  const updateWebhook = (patch: Partial<WebhookForm>) => {
    setForm((f) => ({ ...f, webhook: { ...f.webhook, ...patch } }))
    clear(['webhookMethod', 'webhookUrl', 'webhookHeaders', 'webhookBody', 'webhookDelay'])
  }
  const updateScenario = (patch: Partial<ScenarioForm>) => {
    setForm((f) => ({ ...f, scenario: { ...f.scenario, ...patch } }))
    clear(['scenarioName', 'scenarioRequiredState', 'scenarioNewState'])
  }
  /** A preset always swaps in its example (or none); a typed custom status only when the catalog has one. */
  const setStatus = (preset: Preset, status: number, keepWithoutExample = false) => {
    const example = exampleFor(endpoint, status)
    const refill = !bodyTouched && (example !== '' || !keepWithoutExample)
    if (refill) setExampleStatus(status)
    update({ preset, status, ...(refill ? { body: example } : {}) }, ['status', 'body'])
  }
  /** A text file becomes the body (the endpoint keeps its Content-Type); anything else a binary body with its own. */
  const onBodyFile = (file: BodyFile) => {
    setBodyTouched(true)
    if (file.kind === 'text') update({ body: file.text, binary: null }, ['body'])
    else update({ body: '', binary: { base64: file.base64, name: file.name, size: file.size, contentType: file.contentType } }, ['body'])
    toast.success(t('editor.bodyFile.loaded', { name: file.name }))
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

  /** Flags the required URLs; false when the form has a client-side error to fix first. */
  const ready = () => {
    setAttempted(true)
    return !(
      blocked ||
      (proxied && !isHttpUrl(form.proxy.baseUrl)) ||
      (form.webhook.enabled && !isHttpUrl(form.webhook.url, { templated: true })) ||
      (form.scenario.enabled && form.scenario.name.trim() === '')
    )
  }

  const onPreview = async () => {
    if (!ready()) return
    reset()
    try {
      setPreview(await previewMock.mutateAsync(args()))
    } catch (error) {
      handleError(error, t('editor.previewFailed'))
    }
  }

  const onSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving || !ready()) return
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
        <FieldSet className="gap-2">
          <FieldLegend variant="label" id={id('answer-label')}>
            {t('editor.answer')}
          </FieldLegend>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-labelledby={id('answer-label')}
            value={form.answer}
            onValueChange={(v) => v && update({ answer: v as SimpleForm['answer'] }, ['status', 'body', 'fault', 'delay'])}
            className="flex-wrap"
          >
            <ToggleGroupItem value="mock" className={ON}>
              {t('editor.answer.mock')}
            </ToggleGroupItem>
            <ToggleGroupItem value="proxy" className={ON}>
              {t('editor.answer.proxy')}
            </ToggleGroupItem>
          </ToggleGroup>
        </FieldSet>

        {proxied ? (
          <ProxySection
            integration={integration}
            endpoint={endpoint}
            proxy={form.proxy}
            errors={{ baseUrl: errors.proxyBaseUrl, stripPrefix: errors.proxyStripPrefix, headers: errors.proxyHeaders }}
            onChange={updateProxy}
          />
        ) : (
          <>
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
                <span className="flex flex-wrap items-center gap-2">
                  {!broken && !bodyTouched && form.body !== '' && (
                    <span className="text-[11px] text-muted-foreground">{t('editor.bodyFromExample', { status: exampleStatus })}</span>
                  )}
                  {!broken && !form.binary && <BodyFileButton onFile={onBodyFile} onError={setFileError} />}
                </span>
              </div>
              {!broken && form.binary ? (
                <div
                  role="group"
                  aria-label={t('editor.bodyFile.binary')}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5"
                >
                  <FileIcon aria-hidden className="size-4 shrink-0 text-signal-fg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t('editor.bodyFile.binary')}</span>
                    <span dir="ltr" className="font-mono text-xs [overflow-wrap:anywhere]">
                      {form.binary.name
                        ? t('editor.bodyFile.binaryDetails', { name: form.binary.name, size: formatSize(form.binary.size), type: form.binary.contentType })
                        : t('editor.bodyFile.binaryDetailsNoName', { size: formatSize(form.binary.size), type: form.binary.contentType })}
                    </span>
                  </div>
                  <span className="flex items-center gap-1.5">
                    <BodyFileButton label={t('editor.bodyFile.replace')} onFile={onBodyFile} onError={setFileError} />
                    <Button type="button" variant="ghost" size="xs" onClick={() => update({ binary: null, body: '' }, ['body'])}>
                      <Trash2Icon data-icon="inline-start" />
                      {t('editor.bodyFile.remove')}
                    </Button>
                  </span>
                </div>
              ) : bodyLanguage ? (
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
              {fileError && (
                <p role="alert" className="text-xs text-mismatch">
                  {fileError}
                </p>
              )}
              {fieldError('body')}
            </Field>
          </>
        )}
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
            <Select
              value={proxied ? NO_FAULT : form.fault || NO_FAULT}
              disabled={proxied}
              onValueChange={(v) => update({ fault: v === NO_FAULT ? '' : (v as SimpleForm['fault']) }, ['fault', 'status', 'body'])}>
              <SelectTrigger
                id={id('fault')}
                className="w-full"
                aria-invalid={Boolean(errors.fault)}
                aria-describedby={described('fault', proxied && id('fault-hint'))}
              >
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
            {proxied && (
              <FieldDescription id={id('fault-hint')} className="text-xs">
                {t('editor.proxy.noFault')}
              </FieldDescription>
            )}
            {fieldError('fault')}
          </Field>
        </div>
      </Section>

      <Section title={t('editor.section.callback')}>
        <WebhookSection
          webhook={form.webhook}
          errors={{
            method: errors.webhookMethod,
            url: errors.webhookUrl,
            headers: errors.webhookHeaders,
            body: errors.webhookBody,
            delay: errors.webhookDelay,
          }}
          onChange={updateWebhook}
        />
      </Section>

      <Section title={t('editor.section.scenario')}>
        <ScenarioSection
          scenario={form.scenario}
          existing={scenarios.data ?? []}
          selfId={mock?.id}
          errors={{ name: errors.scenarioName, requiredState: errors.scenarioRequiredState, newState: errors.scenarioNewState }}
          onChange={updateScenario}
        />
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
