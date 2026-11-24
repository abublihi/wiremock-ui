import { useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { AlertTriangleIcon, CopyIcon, InfoIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { useCreateMock, usePreviewMock, useTags, useUpdateMock } from '@/ui/api/queries'
import { tagsOf } from '@/server/mocks/tags'
import { TagsField } from '@/ui/components/mocks/TagsField'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog'
import { Button } from '@/ui/components/ui/button'
import { Spinner } from '@/ui/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'
import {
  type EditableStub,
  type ScenarioSeed,
  type SimpleForm,
  emptyForm,
  emptyQuickForm,
  fromEditable,
  fromQuickStub,
  fromStub,
  linkOf,
  parseStubJson,
  seedScenario,
  withKey,
  toEditable,
  toQuickInput,
  toSimpleInput,
  withTags,
} from '@/ui/lib/editor-sync'
import { AdvancedEditor } from './AdvancedEditor'
import { HistorySheet } from './HistorySheet'
import { SimpleEditor } from './SimpleEditor'

export type EditorMode = 'simple' | 'advanced'
export type Catalog = { integration: Integration; endpoint: Endpoint }

const BLANK = JSON.stringify(
  { name: '', request: { method: 'GET', urlPath: '/' }, response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: {} } },
  null,
  2,
)
const TAB =
  'px-3 text-xs data-active:border-signal/40 data-active:bg-signal/10 data-active:text-signal-fg dark:data-active:border-signal/40 dark:data-active:bg-signal/10 dark:data-active:text-signal-fg'
const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const sameForm = (a: SimpleForm | null, b: SimpleForm | null) => JSON.stringify(a) === JSON.stringify(b)
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

/**
 * The mock editor: Simple and Advanced tabs over one draft, save conflicts that keep the draft,
 * history (for a saved mock) and a guard against leaving with unsaved changes.
 */
export function MockEditor({
  mock,
  catalog,
  keyValue,
  quick,
  initialStub,
  scenarioSeed,
  simpleUnavailable,
  initialMode,
  onModeChange,
  onFormChange,
  onSaved,
  onReload,
  onRestored,
}: {
  /** The saved version this draft starts from; undefined for a new mock. */
  mock?: StubMapping
  /** The catalog endpoint Simple mode edits; undefined for a free-form mock. */
  catalog?: Catalog
  /** A new endpoint mock's key value ("Make a mock for p-2"); ignored when the endpoint has no key. */
  keyValue?: string
  /** A new quick mock of a URL ("Mock a URL directly"): opens in the quick Simple form. */
  quick?: boolean
  /** A new free-form mock's starting JSON (instead of the blank stub): in the quick form when it can show it, else Advanced. */
  initialStub?: EditableStub
  /** A new mock's scenario ("Add a mock to this scenario"): the Scenario section, or the JSON, starts with it. */
  scenarioSeed?: ScenarioSeed
  /** Why Simple mode can't be used at all (no catalog link, endpoint gone). */
  simpleUnavailable?: string
  initialMode?: EditorMode
  onModeChange?: (mode: EditorMode) => void
  /** Every change of the Simple form (e.g. the page follows the scenario state it answers in). */
  onFormChange?: (form: SimpleForm) => void
  onSaved: (stub: StubMapping, mode: EditorMode) => void | Promise<void>
  /** Fetches the live version and starts over from it (conflict → Reload). */
  onReload?: () => Promise<void>
  /** A version was restored from history; the page decides whether to load it. */
  onRestored?: (stub: StubMapping, dirty: boolean) => void
}) {
  const t = useT()
  const wiremockOnly = useWireMockOnly()
  const link = mock ? linkOf(mock) : catalog && { integration: catalog.integration.key, endpoint: catalog.endpoint.key }
  // A free-form mock (no catalog link) edits in the quick form whenever its stub is one the quick form can show.
  const quickable = !catalog && !link

  const [init] = useState(() => {
    const form = catalog
      ? mock
        ? fromStub(mock, catalog.integration, catalog.endpoint)
        : seedScenario(withKey(emptyForm(catalog.endpoint), catalog.endpoint, keyValue), scenarioSeed)
      : quickable && mock
        ? fromQuickStub(mock)
        : quickable && quick
          ? emptyQuickForm(scenarioSeed)
          : quickable && initialStub
            ? // A starting stub the quick form can show (a logged request's method, path and body) opens there.
              fromQuickStub(seedStub(initialStub, scenarioSeed))
            : null
    const start = initialStub ?? (JSON.parse(BLANK) as EditableStub)
    const seeded = scenarioSeed ? { ...start, scenarioName: scenarioSeed.name, requiredScenarioState: scenarioSeed.requiredState } : start
    const text = mock ? pretty(toEditable(mock)) : catalog || quick ? '' : initialStub || scenarioSeed ? pretty(seeded) : BLANK
    const mode: EditorMode = form && initialMode !== 'advanced' ? 'simple' : 'advanced'
    return { form, text, mode }
  })
  const [mode, setMode] = useState<EditorMode>(init.mode)
  // Simple mode's seed: the form it opened with (null: the draft has something Simple mode can't show).
  const [simple, setSimple] = useState<{ form: SimpleForm | null; invalidJson: boolean; n: number }>({
    form: init.form,
    invalidJson: false,
    n: 0,
  })
  const formRef = useRef<SimpleForm | null>(init.form)
  const [simpleChanged, setSimpleChanged] = useState(false)
  const [text, setText] = useState(init.text)
  const [textSeed, setTextSeed] = useState(init.text)
  // Unsaved changes made before the last switch between tabs.
  const [carried, setCarried] = useState(false)
  // Tags sit above both tabs: one list, saved by either.
  const [initialTags] = useState(() => (mock ? tagsOf(mock) : []))
  const [tags, setTags] = useState(initialTags)
  const tagsChanged = tags.join(',') !== initialTags.join(',')
  const knownTags = useTags()
  const dirty = carried || tagsChanged || (mode === 'simple' ? simpleChanged : text !== textSeed)

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<{ title: string; message: string } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)
  const [reloading, setReloading] = useState(false)

  const preview = usePreviewMock()
  const createMock = useCreateMock()
  const updateMock = useUpdateMock()

  // Leaving with unsaved changes asks first (in-app navigation and closing the tab).
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const leaving = useRef(false)
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !leaving.current,
    enableBeforeUnload: () => dirtyRef.current && !leaving.current,
    withResolver: true,
  })

  const buildFromForm = (form: SimpleForm) =>
    preview.mutateAsync(
      form.quick
        ? { quick: toQuickInput(form) }
        : { integration: catalog!.integration.key, endpoint: catalog!.endpoint.key, input: toSimpleInput(form) },
    )

  const changeMode = async (next: EditorMode) => {
    if (next === mode || preview.isPending) return
    if (next === 'advanced') {
      // Simple → Advanced: the stub the server builds from the form (unless Simple had nothing to show).
      const form = formRef.current
      if (simple.form && form && (catalog || quickable)) {
        try {
          const built = pretty(toEditable(await buildFromForm(form)))
          setText(built)
          setTextSeed(built)
        } catch (error) {
          toast.error(t('editor.previewFailed'), { description: messageOf(error, t('error.generic')) })
          return
        }
      }
    } else {
      // Advanced → Simple: read the JSON back; anything the form can't show keeps Simple closed.
      const parsed = parseStubJson(text)
      const stub = parsed.ok ? ({ id: mock?.id ?? '', ...fromEditable(parsed.value, link) } as StubMapping) : null
      const form = stub && catalog ? fromStub(stub, catalog.integration, catalog.endpoint) : stub && quickable ? fromQuickStub(stub) : null
      formRef.current = form
      setSimple((s) => ({ form, invalidJson: !parsed.ok, n: s.n + 1 }))
      setSimpleChanged(false)
    }
    setCarried(dirty)
    setMode(next)
    onModeChange?.(next)
  }

  const finishSave = async (saved: StubMapping, savedIn: EditorMode) => {
    leaving.current = true
    await onSaved(saved, savedIn)
  }

  const saveAdvanced = async (value: EditableStub) => {
    setFormError(null)
    setSaving(true)
    try {
      const stub = withTags(fromEditable(value, link), tags)
      const version = mock?.metadata?.wiremockUi?.version ?? 0
      const saved = mock ? await updateMock.mutateAsync({ id: mock.id, stub, version }) : await createMock.mutateAsync(stub)
      setConflict(false)
      toast.success(t('editor.saved'))
      await finishSave(saved, 'advanced')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true)
      else setFormError({ title: t('editor.saveFailed'), message: messageOf(error, t('error.generic')) })
    } finally {
      setSaving(false)
    }
  }

  const reload = async () => {
    if (!onReload) return
    setConfirmReload(false)
    setReloading(true)
    try {
      await onReload() // the page starts a fresh editor on the live version
    } catch (error) {
      toast.error(t('editor.reloadFailed'), { description: messageOf(error, t('error.generic')) })
      setReloading(false)
    }
  }

  const copyDraft = async () => {
    try {
      const json = mode === 'advanced' ? text : pretty(toEditable(await buildFromForm(formRef.current!)))
      await navigator.clipboard.writeText(json)
      toast.success(t('editor.copied'))
    } catch (error) {
      toast.error(t('editor.copyFailed'), { description: messageOf(error, '') || undefined })
    }
  }

  const endpointLabel = catalog && t('editor.endpointRef', { integration: catalog.integration.name, endpoint: catalog.endpoint.name })
  const unavailable = !catalog && !quickable ? simpleUnavailable : simple.invalidJson ? t('editor.fixJsonFirst') : t('editor.cantShow')

  return (
    <div className="flex flex-col gap-4">
      {conflict && (
        <Alert className="border-hazard/50 bg-hazard/10 text-foreground">
          <AlertTriangleIcon className="text-hazard-fg" />
          <AlertTitle>{t('editor.saveFailed')}</AlertTitle>
          <AlertDescription>{t('editor.conflict')}</AlertDescription>
          <AlertAction className="flex flex-wrap gap-2 max-sm:static max-sm:col-span-full max-sm:mt-2">
            <Button size="sm" variant="outline" disabled={reloading} onClick={() => (dirty ? setConfirmReload(true) : void reload())}>
              {reloading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              {t('editor.reload')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copyDraft()}>
              <CopyIcon data-icon="inline-start" />
              {t('editor.copyJson')}
            </Button>
          </AlertAction>
        </Alert>
      )}

      <TagsField tags={tags} onChange={setTags} suggestions={knownTags.data?.map((x) => x.tag)} />

      <Tabs value={mode} onValueChange={(v) => void changeMode(v as EditorMode)} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList aria-label={t('editor.mode')} className="border border-line bg-surface-2">
            <TabsTrigger value="simple" className={TAB}>
              {t('editor.mode.simple')}
            </TabsTrigger>
            <TabsTrigger value="advanced" className={TAB}>
              {preview.isPending && mode === 'simple' && <Spinner data-icon="inline-start" />}
              {t('editor.mode.advanced')}
            </TabsTrigger>
          </TabsList>
          {mock && onRestored && !wiremockOnly && <HistorySheet id={mock.id} keepsDraft={dirty} onRestored={(stub) => onRestored(stub, dirty)} />}
        </div>

        <TabsContent value="simple">
          {(catalog || quickable) && simple.form ? (
            <SimpleEditor
              key={simple.n}
              integration={catalog?.integration}
              endpoint={catalog?.endpoint}
              // A fresh new mock lets the body follow the catalog example; anything else is the user's draft.
              initial={mock || initialStub || simple.n > 0 ? simple.form : undefined}
              mock={mock}
              keyValue={keyValue}
              scenarioSeed={scenarioSeed}
              tags={tags}
              onChange={(form) => {
                formRef.current = form
                onFormChange?.(form)
                setSimpleChanged(!sameForm(form, simple.form))
              }}
              onSaved={(saved) => finishSave(saved, 'simple')}
              onConflict={() => setConflict(true)}
            />
          ) : (
            <Alert>
              <InfoIcon />
              <AlertTitle>{unavailable}</AlertTitle>
              <AlertDescription>
                <Button variant="link" size="sm" className="h-auto p-0 text-signal-fg" onClick={() => void changeMode('advanced')}>
                  {t('editor.cantShowAction')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="advanced">
          <AdvancedEditor
            text={text}
            onTextChange={setText}
            mock={mock}
            endpointLabel={endpointLabel}
            jsonEndpoint={catalog?.endpoint.contentType === 'json'}
            saving={saving}
            error={formError}
            onSave={(value) => void saveAdvanced(value)}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('editor.discardBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('editor.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void reload()}>
              {t('editor.discardReload')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('editor.leaveBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>{t('editor.stay')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('editor.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** A starting stub as a stub the quick form can read: no id yet, and the scenario it is added to. */
function seedStub(stub: EditableStub, seed?: ScenarioSeed): StubMapping {
  const seeded = seed ? { ...stub, scenarioName: seed.name, requiredScenarioState: seed.requiredState } : stub
  return { id: '', ...seeded } as StubMapping
}
