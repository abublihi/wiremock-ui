import { useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { AlertTriangleIcon, CopyIcon, InfoIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { useCreateMock, usePreviewMock, usePreviewMockGroup, useTags, useUpdateMock } from '@/ui/api/queries'
import { tagsOf } from '@/server/mocks/tags'
import { TagsField } from '@/ui/components/mocks/TagsField'
import { groupOf, valuesLabel, type GroupMeta } from '@/server/mocks/groups'
import { type Responses, groupInputFrom, noResponses, responsesFromStubs, withValuesRow } from '@/ui/lib/groups'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'
import {
  type EditableStub,
  type ScenarioSeed,
  type SimpleForm,
  emptyQuickForm,
  fromEditable,
  fromQuickStub,
  parseStubJson,
  toEditable,
  toQuickInput,
  withTags,
} from '@/ui/lib/editor-sync'
import { AdvancedEditor } from './AdvancedEditor'
import { HistorySheet } from './HistorySheet'
import { type SavedGroup, SimpleEditor } from './SimpleEditor'

export type EditorMode = 'simple' | 'advanced'

const BLANK = JSON.stringify(
  { name: '', request: { method: 'GET', urlPath: '/' }, response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: {} } },
  null,
  2,
)
const TAB =
  'px-3 text-xs data-active:border-signal/40 data-active:bg-signal/10 data-active:text-signal-fg dark:data-active:border-signal/40 dark:data-active:bg-signal/10 dark:data-active:text-signal-fg'
const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const sameForm = (a: SimpleForm | null, b: SimpleForm | null) => JSON.stringify(a) === JSON.stringify(b)
const sameResponses = (a: Responses, b: Responses) =>
  JSON.stringify({ ...a, rows: a.rows.map(({ key: _k, ...r }) => r) }) === JSON.stringify({ ...b, rows: b.rows.map(({ key: _k, ...r }) => r) })

/** One stub of a mock with several responses in Advanced mode: which response it is, its JSON, its saved id. */
type StubEntry = { id?: string; meta?: GroupMeta; text: string; seed: string }
/** `stub` with `metadata.wiremockUi.group` set back (the JSON editor never shows the UI's metadata). */
function withGroup<T extends { metadata?: Record<string, unknown> }>(stub: T, group: GroupMeta | undefined): T {
  if (!group) return stub
  const meta = stub.metadata ?? {}
  const ui = (typeof meta.wiremockUi === 'object' && meta.wiremockUi !== null ? meta.wiremockUi : {}) as Record<string, unknown>
  return { ...stub, metadata: { ...meta, wiremockUi: { ...ui, group } } }
}

const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)

/**
 * The mock editor: Simple and Advanced tabs over one draft, save conflicts that keep the draft,
 * history (for a saved mock) and a guard against leaving with unsaved changes.
 */
export function MockEditor({
  mock,
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
  group,
  addValues,
  onGroupSaved,
  onTest,
}: {
  /** The saved version this draft starts from; undefined for a new mock. */
  mock?: StubMapping
  /** A new quick mock of a URL ("Mock a URL directly"): opens in the quick Simple form. */
  quick?: boolean
  /** A new free-form mock's starting JSON (instead of the blank stub): in the quick form when it can show it, else Advanced. */
  initialStub?: EditableStub
  /** A new mock's scenario ("Add a mock to this scenario"): the Scenario section, or the JSON, starts with it. */
  scenarioSeed?: ScenarioSeed
  /** Why Simple mode can't be used for this mock at all (e.g. a JSON stub from a logged request). */
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
  /** The saved mock with several responses this editor opened (`mock` is one of its stubs). */
  group?: SavedGroup
  /** "Add a response for 999" (a near miss): a response with these values starts in the list. */
  addValues?: (string | null)[]
  onGroupSaved?: (stubs: StubMapping[]) => void | Promise<void>
  /** Test one saved response of a mock with several responses. */
  onTest?: (stub: StubMapping) => void
}) {
  const t = useT()
  const wiremockOnly = useWireMockOnly()
  const [init] = useState(() => {
    if (group) {
      // A mock with several responses: the form and its responses, or (when they can't be shown) each stub's JSON.
      const read = responsesFromStubs(group.stubs)
      const responses = read && addValues ? withValuesRow(read.form, read.responses, addValues) : read?.responses
      const entries = group.stubs.map((stub) => {
        const text = pretty(toEditable(stub))
        return { id: stub.id, meta: groupOf(stub), text, seed: text }
      })
      return { form: read?.form ?? null, responses: responses ?? noResponses(), text: '', mode: (read && initialMode !== 'advanced' ? 'simple' : 'advanced') as EditorMode, entries }
    }
    // Simple mode is the URL form, whenever the stub is one it can show.
    const form = mock
      ? fromQuickStub(mock)
      : quick
        ? emptyQuickForm(scenarioSeed)
        : initialStub
          ? // A starting stub the quick form can show (a logged request's method, path and body) opens there.
            fromQuickStub(seedStub(initialStub, scenarioSeed))
          : null
    const start = initialStub ?? (JSON.parse(BLANK) as EditableStub)
    const seeded = scenarioSeed ? { ...start, scenarioName: scenarioSeed.name, requiredScenarioState: scenarioSeed.requiredState } : start
    const text = mock ? pretty(toEditable(mock)) : quick ? '' : initialStub || scenarioSeed ? pretty(seeded) : BLANK
    const mode: EditorMode = form && initialMode !== 'advanced' ? 'simple' : 'advanced'
    return { form, responses: noResponses(), text, mode, entries: null as StubEntry[] | null }
  })
  const [mode, setMode] = useState<EditorMode>(init.mode)
  // Simple mode's seed: the form it opened with (null: the draft has something Simple mode can't show).
  const [simple, setSimple] = useState<{ form: SimpleForm | null; responses: Responses; invalidJson: boolean; n: number }>({
    form: init.form,
    responses: init.responses,
    invalidJson: false,
    n: 0,
  })
  const formRef = useRef<SimpleForm | null>(init.form)
  const responsesRef = useRef<Responses>(init.responses)
  const [formChanged, setFormChanged] = useState(false)
  const [responsesChanged, setResponsesChanged] = useState(Boolean(addValues && init.responses.rows.some((r) => !r.stubId)))
  const simpleChanged = formChanged || responsesChanged
  // Advanced mode of a mock with several responses: one JSON per stub, one shown at a time.
  const [entries, setEntries] = useState<StubEntry[] | null>(init.entries)
  const [selected, setSelected] = useState(0)
  const entry = entries?.[selected]
  const entriesChanged = entries?.some((e) => e.text !== e.seed) ?? false
  const [text, setText] = useState(init.text)
  const [textSeed, setTextSeed] = useState(init.text)
  // Unsaved changes made before the last switch between tabs.
  const [carried, setCarried] = useState(false)
  // Tags sit above both tabs: one list, saved by either.
  const [initialTags] = useState(() => (mock ? tagsOf(mock) : []))
  const [tags, setTags] = useState(initialTags)
  const tagsChanged = tags.join(',') !== initialTags.join(',')
  const knownTags = useTags()
  const dirty = carried || tagsChanged || (mode === 'simple' ? simpleChanged : entries ? entriesChanged : text !== textSeed)

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<{ title: string; message: string } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)
  const [reloading, setReloading] = useState(false)

  const preview = usePreviewMock()
  const previewGroup = usePreviewMockGroup()
  const isGroup = () => group !== undefined || responsesRef.current.rows.length > 0
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

  const buildFromForm = (form: SimpleForm) => preview.mutateAsync({ quick: toQuickInput(form) })
  /** The stubs the form and its responses make, each with the saved id it will keep (none for a new response). */
  const entriesFromForm = async (form: SimpleForm): Promise<StubEntry[]> => {
    const responses = responsesRef.current
    const built = await previewGroup.mutateAsync({ input: groupInputFrom(form, tags, responses), id: group?.id })
    const ids = [...responses.rows.map((r) => r.stubId), ...(responses.fallbackOn || responses.rows.length === 0 ? [responses.fallbackStubId ?? (responses.rows.length === 0 ? mock?.id : undefined)] : [])]
    return built.map((stub, i) => {
      const text = pretty(toEditable(stub))
      return { id: ids[i], meta: groupOf(stub), text, seed: text }
    })
  }

  const changeMode = async (next: EditorMode) => {
    if (next === mode || preview.isPending || previewGroup.isPending) return
    if (next === 'advanced' && isGroup()) {
      // Simple → Advanced: one stub per response, as the server builds them (unless Simple had nothing to show).
      const form = formRef.current
      if (simple.form && form) {
        try {
          const built = await entriesFromForm(form)
          setEntries(built)
          setSelected((i) => Math.min(i, built.length - 1))
        } catch (error) {
          toast.error(t('editor.previewFailed'), { description: messageOf(error, t('error.generic')) })
          return
        }
      }
    } else if (next === 'simple' && entries) {
      // Advanced → Simple: read every stub's JSON back; anything the form can't show keeps Simple closed.
      const parsed = entries.map((e) => ({ e, json: parseStubJson(e.text) }))
      const invalidJson = parsed.some((p) => !p.json.ok)
      const stubs = invalidJson
        ? []
        : parsed.map(({ e, json }) => withGroup({ id: e.id ?? '', ...fromEditable((json as { value: EditableStub }).value, undefined) } as StubMapping, e.meta))
      const read = stubs.length === 1 && !stubs[0]!.metadata?.wiremockUi?.group ? null : stubs.length > 0 ? responsesFromStubs(stubs) : null
      const single = stubs.length === 1 && !read ? fromQuickStub(stubs[0]!) : null
      const form = read?.form ?? single
      const responses = read ? { ...read.responses, rows: read.responses.rows.map((r) => ({ ...r, stubId: r.stubId || undefined })) } : noResponses()
      formRef.current = form
      responsesRef.current = responses
      setSimple((s) => ({ form, responses, invalidJson, n: s.n + 1 }))
      setFormChanged(false)
      setResponsesChanged(false)
    } else if (next === 'advanced') {
      // Simple → Advanced: the stub the server builds from the form (unless Simple had nothing to show).
      const form = formRef.current
      setEntries(null)
      if (simple.form && form) {
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
      const stub = parsed.ok ? ({ id: mock?.id ?? '', ...fromEditable(parsed.value, undefined) } as StubMapping) : null
      const form = stub ? fromQuickStub(stub) : null
      formRef.current = form
      responsesRef.current = noResponses()
      setSimple((s) => ({ form, responses: noResponses(), invalidJson: !parsed.ok, n: s.n + 1 }))
      setFormChanged(false)
      setResponsesChanged(false)
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
      // One response of a mock with several responses stays in its group.
      const target = entry?.id ? (group?.stubs.find((s) => s.id === entry.id) ?? mock) : mock
      const meta = entries ? entry?.meta : target && groupOf(target)
      const stub = withGroup(withTags(fromEditable(value, undefined), tags), meta)
      const version = target?.metadata?.wiremockUi?.version ?? 0
      const saved = target ? await updateMock.mutateAsync({ id: target.id, stub, version }) : await createMock.mutateAsync(stub)
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
      const json =
        mode === 'advanced'
          ? (entry?.text ?? text)
          : isGroup()
            ? JSON.stringify((await entriesFromForm(formRef.current!)).map((e) => JSON.parse(e.text) as unknown), null, 2)
            : pretty(toEditable(await buildFromForm(formRef.current!)))
      await navigator.clipboard.writeText(json)
      toast.success(t('editor.copied'))
    } catch (error) {
      toast.error(t('editor.copyFailed'), { description: messageOf(error, '') || undefined })
    }
  }

  const unavailable = simple.invalidJson ? t('editor.fixJsonFirst') : (simpleUnavailable ?? t('editor.cantShow'))

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
              {(preview.isPending || previewGroup.isPending) && mode === 'simple' && <Spinner data-icon="inline-start" />}
              {t('editor.mode.advanced')}
            </TabsTrigger>
          </TabsList>
          {mock && onRestored && !wiremockOnly && <HistorySheet id={mock.id} keepsDraft={dirty} onRestored={(stub) => onRestored(stub, dirty)} />}
        </div>

        <TabsContent value="simple">
          {simple.form ? (
            <SimpleEditor
              key={simple.n}
              // A fresh new mock lets the body follow the catalog example; anything else is the user's draft.
              initial={mock || initialStub || group || simple.n > 0 ? simple.form : undefined}
              initialResponses={simple.responses}
              mock={mock}
              group={group}
              scenarioSeed={scenarioSeed}
              tags={tags}
              onChange={(form) => {
                formRef.current = form
                onFormChange?.(form)
                setFormChanged(!sameForm(form, simple.form))
              }}
              onResponsesChange={(responses) => {
                responsesRef.current = responses
                setResponsesChanged(!sameResponses(responses, simple.responses))
              }}
              onSaved={(saved) => finishSave(saved, 'simple')}
              onGroupSaved={async (stubs) => {
                leaving.current = true
                if (onGroupSaved) await onGroupSaved(stubs)
                else await onSaved(stubs[0]!, 'simple')
              }}
              onConflict={() => setConflict(true)}
              onTest={onTest}
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
          {entries && entry ? (
            <AdvancedEditor
              key={selected}
              text={entry.text}
              onTextChange={(next) => setEntries((list) => list!.map((e, i) => (i === selected ? { ...e, text: next } : e)))}
              mock={group?.stubs.find((s) => s.id === entry.id)}
              saving={saving}
              error={formError}
              saveDisabledReason={entry.id ? undefined : t('responses.advancedNew')}
              above={
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{t('responses.advancedPick')}</span>
                    <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
                      <SelectTrigger className="w-auto min-w-64" aria-label={t('responses.advancedPick')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {entries.map((e, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {entryLabel(e, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">{t('responses.advancedCount', { n: selected + 1, count: entries.length })}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('responses.advancedHint')}</p>
                </div>
              }
              onSave={(value) => void saveAdvanced(value)}
            />
          ) : (
            <AdvancedEditor
              text={text}
              onTextChange={setText}
              mock={mock}
              saving={saving}
              error={formError}
              onSave={(value) => void saveAdvanced(value)}
            />
          )}
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

/** "orderId = 2003 · X-Tenant = acme", "Every other request", plus "(new)" for a response not saved yet. */
function entryLabel(e: StubEntry, t: ReturnType<typeof useT>): string {
  const what = e.meta?.values ? valuesLabel(e.meta.by, e.meta.values) : t('responses.everyOther')
  return e.id ? what : t('responses.advancedNewLabel', { what })
}
