import { useId, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { AlertCircleIcon, ListTreeIcon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { KEY_LOCATIONS, templateVariables } from '@/server/mocks/groups'
import type { KeyLocation } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'
import { ApiError } from '@/ui/api/client'
import { useTags } from '@/ui/api/queries'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { TagsField } from '@/ui/components/mocks/TagsField'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Spinner } from '@/ui/components/ui/spinner'
import { Textarea } from '@/ui/components/ui/textarea'
import { useT } from '@/ui/i18n'
import type { MessageKey } from '@/ui/i18n'
import { type QuickRequest } from '@/ui/lib/editor-sync'
import {
  type GroupForm,
  type ResponseForm,
  answerFor,
  byLabel,
  emptyResponse,
  fallbackPriority,
  groupProblems,
  rowKey,
} from '@/ui/lib/groups'
import { cn } from '@/ui/lib/utils'
import { HeaderRows } from './HeaderRows'
import { QuickRequestFields, quickRequestErrors } from './QuickRequestFields'

const LOCATION_KEY: Record<KeyLocation, MessageKey> = {
  path: 'groups.byPath',
  query: 'groups.byQuery',
  header: 'groups.byHeader',
  jsonPath: 'groups.byJsonPath',
  xPath: 'groups.byXPath',
  form: 'groups.byForm',
}

/** A one-line summary of a response: its body's start, or its Content-Type. */
function summary(r: ResponseForm): string {
  const text = r.body.replace(/\s+/g, ' ').trim()
  if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text
  return r.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? ''
}

/**
 * A mock with several responses, picked by one value in the request: the shared request, "Answer differently by",
 * a row per value, the "Any other" row and a Try it box. `onSave` writes the whole group (the page knows whether it
 * creates or updates); a 409 says someone changed it meanwhile.
 */
export function GroupEditor({
  initial,
  onSave,
  onCancel,
  cancelLabel,
}: {
  initial: GroupForm
  onSave: (form: GroupForm) => Promise<StubMapping[]>
  /** Leaves the editor without saving (e.g. back to the one-response mock it grew from). */
  onCancel?: () => void
  cancelLabel?: string
}) {
  const t = useT()
  const ids = useId()
  const knownTags = useTags()
  const [form, setForm] = useState(initial)
  const [open, setOpen] = useState<string | null>(initial.rows.find((r) => r.value === '')?.key ?? null)
  const [tryValue, setTryValue] = useState(initial.rows[0]?.value ?? '')
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const leaving = useRef(false)
  useBlocker({ shouldBlockFn: () => dirty && !leaving.current && !saving, enableBeforeUnload: () => dirty && !saving })

  const by = byLabel(form.by)
  const problems = groupProblems(form)
  const quickErrors = quickRequestErrors(t, { ...form.quick, responseHeaders: [] }, attempted)
  const blocked = Object.keys(problems).length > 0 || Object.keys(quickErrors).length > 0
  const shown = (key: string) => (attempted || key === 'by' ? problems[key] : problems[key] === 'valueTwice' ? problems[key] : undefined)
  const vars = form.quick.urlType === 'template' ? templateVariables(form.quick.url) : []
  const answer = tryValue === '' ? ({ kind: 'empty' } as const) : answerFor(form, tryValue)
  const stubs = form.rows.length + (form.fallback.on ? 1 : 0)

  const patch = (next: Partial<GroupForm>) => setForm((f) => ({ ...f, ...next }))
  const patchRow = (key: string, next: Partial<GroupForm['rows'][number]>) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.key === key ? { ...r, ...next } : r)) }))

  const save = async () => {
    setAttempted(true)
    if (blocked) return
    setSaving(true)
    setError(null)
    try {
      leaving.current = true
      await onSave(form)
      toast.success(t('editor.saved'))
    } catch (e) {
      leaving.current = false
      if (e instanceof ApiError && e.status === 409) setError({ title: t('editor.saveFailed'), message: t('editor.conflict') })
      else setError({ title: t('editor.saveFailed'), message: e instanceof Error && e.message ? e.message : t('error.generic') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      className="flex flex-col gap-4"
    >
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-name`} className="text-xs font-medium">
            {t('groups.name')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
          </label>
          <Input id={`${ids}-name`} value={form.name} onChange={(e) => patch({ name: e.target.value })} className="max-w-md" />
        </div>
        <TagsField tags={form.tags} onChange={(tags) => patch({ tags })} suggestions={knownTags.data?.map((x) => x.tag)} />
      </div>

      <section aria-labelledby={`${ids}-req`} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
        <h2 id={`${ids}-req`} className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          {t('editor.section.match')}
        </h2>
        <QuickRequestFields
          quick={{ ...form.quick, responseHeaders: [] }}
          errors={quickErrors}
          onChange={(next: Partial<QuickRequest>) => {
            const { responseHeaders: _r, ...rest } = next
            patch({ quick: { ...form.quick, ...rest } })
          }}
        />
      </section>

      <section aria-labelledby={`${ids}-resp`} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id={`${ids}-resp`} className="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
            <ListTreeIcon aria-hidden className="size-3.5" />
            {t('groups.responsesTitle', { count: form.rows.length + (form.fallback.on ? 1 : 0), by })}
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label id={`${ids}-by-label`} className="text-xs font-medium">
                {t('groups.byLabel')}
              </label>
              <Select
                value={form.by.location}
                onValueChange={(location) =>
                  patch({ by: { location: location as KeyLocation, expression: location === 'path' ? (vars.at(-1) ?? '') : '' } })
                }
              >
                <SelectTrigger aria-labelledby={`${ids}-by-label`} className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KEY_LOCATIONS.map((l) => (
                    <SelectItem key={l} value={l} disabled={l === 'path' && vars.length === 0}>
                      {t(LOCATION_KEY[l])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-by-expr`} className="text-xs font-medium">
                {t(form.by.location === 'path' ? 'groups.byVariable' : form.by.location === 'jsonPath' || form.by.location === 'xPath' ? 'groups.byExpression' : 'groups.byName')}
              </label>
              {form.by.location === 'path' ? (
                <Select value={form.by.expression} onValueChange={(expression) => patch({ by: { ...form.by, expression } })}>
                  <SelectTrigger id={`${ids}-by-expr`} className="w-40 font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {vars.map((v) => (
                      <SelectItem key={v} value={v} className="font-mono">
                        {`{${v}}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`${ids}-by-expr`}
                  value={form.by.expression}
                  dir="ltr"
                  className="w-48 font-mono"
                  placeholder={form.by.location === 'jsonPath' ? '$.id' : form.by.location === 'xPath' ? '//id/text()' : form.by.location === 'header' ? 'X-Tenant' : 'id'}
                  aria-invalid={Boolean(shown('by'))}
                  aria-describedby={shown('by') ? `${ids}-by-error` : undefined}
                  onChange={(e) => patch({ by: { ...form.by, expression: e.target.value } })}
                />
              )}
            </div>
          </div>
        </div>
        {shown('by') && (
          <p id={`${ids}-by-error`} role="alert" className="text-xs text-mismatch">
            {t(`groups.problem.${shown('by')}` as MessageKey, { by })}
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {form.rows.map((row) => {
            const isOpen = open === row.key
            const hit = answer.kind === 'row' && answer.row.key === row.key
            const problem = shown(row.key)
            return (
              <li key={row.key} className={cn('rounded-md border', hit ? 'border-signal/60 bg-signal/5' : 'border-line')}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                  <label htmlFor={`${ids}-${row.key}-v`} className="font-medium">
                    {t('groups.whenLabel', { by })}
                  </label>
                  <Input
                    id={`${ids}-${row.key}-v`}
                    value={row.value}
                    dir="ltr"
                    placeholder={t('groups.valuePlaceholder')}
                    aria-invalid={Boolean(problem)}
                    aria-describedby={problem ? `${ids}-${row.key}-e` : undefined}
                    onChange={(e) => patchRow(row.key, { value: e.target.value })}
                    className="h-8 w-36 font-mono"
                  />
                  <span aria-hidden className="text-muted-foreground">
                    →
                  </span>
                  <StatusBadge status={Number(row.response.status) || 0} />
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{summary(row.response)}</span>
                  {hit && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t('groups.answersTest')}</span>}
                  <Button type="button" size="sm" variant="outline" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : row.key)}>
                    {t(isOpen ? 'groups.close' : 'groups.edit')}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={form.rows.length === 1}
                    aria-label={t('groups.remove', { by, value: row.value || '…' })}
                    onClick={() => patch({ rows: form.rows.filter((r) => r.key !== row.key) })}
                  >
                    <Trash2Icon />
                  </Button>
                  {problem && (
                    <p id={`${ids}-${row.key}-e`} role="alert" className="basis-full text-mismatch">
                      {t(`groups.problem.${problem}` as MessageKey, { by })}
                    </p>
                  )}
                </div>
                {isOpen && (
                  <ResponseFields id={`${ids}-${row.key}`} value={row.response} onChange={(response) => patchRow(row.key, { response })} />
                )}
              </li>
            )
          })}
        </ul>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start border-dashed"
          onClick={() => {
            const key = rowKey()
            const last = form.rows.at(-1)?.response
            patch({ rows: [...form.rows, { key, value: '', response: last ? { ...last, headers: [...last.headers] } : emptyResponse() }] })
            setOpen(key)
          }}
        >
          <PlusIcon data-icon="inline-start" />
          {t('groups.add')}
        </Button>

        <div className={cn('flex flex-col gap-2 rounded-md border border-dashed px-3 py-2 text-xs', answer.kind === 'fallback' ? 'border-signal/60 bg-signal/5' : 'border-line')}>
          <div className="flex flex-wrap items-center gap-2">
            <span id={`${ids}-fb`} className="font-medium">
              {t('groups.anyOther', { by })}
            </span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <div role="radiogroup" aria-labelledby={`${ids}-fb`} className="flex gap-1 rounded-md border border-line bg-surface p-0.5">
              {([true, false] as const).map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  role="radio"
                  aria-checked={form.fallback.on === on}
                  onClick={() => patch({ fallback: { ...form.fallback, on } })}
                  className={cn('rounded px-2 py-1', form.fallback.on === on ? 'bg-signal/10 text-signal-fg' : 'text-muted-foreground hover:text-foreground')}
                >
                  {t(on ? 'groups.fallbackRespond' : 'groups.fallbackNone')}
                </button>
              ))}
            </div>
            {answer.kind === 'fallback' && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{t('groups.answersTest')}</span>}
          </div>
          {form.fallback.on ? (
            <>
              <p className="text-muted-foreground">{t('groups.fallbackHint', { priority: fallbackPriority(form) })}</p>
              <ResponseFields id={`${ids}-fallback`} value={form.fallback.response} onChange={(response) => patch({ fallback: { on: true, response } })} />
              {attempted && problems.fallback && (
                <p role="alert" className="text-mismatch">
                  {t(`groups.problem.${problems.fallback}` as MessageKey, { by })}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">{t('groups.fallbackNoneHint')}</p>
          )}
        </div>
      </section>

      <section aria-labelledby={`${ids}-try`} className="flex flex-col gap-2 rounded-md border border-signal/40 bg-surface p-4 text-xs">
        <h2 id={`${ids}-try`} className="text-[11px] tracking-[0.14em] text-signal-fg uppercase">
          {t('groups.tryTitle')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${ids}-try-v`} className="font-medium">
            {t('groups.whenLabel', { by })}
          </label>
          <Input id={`${ids}-try-v`} value={tryValue} dir="ltr" onChange={(e) => setTryValue(e.target.value)} className="h-8 w-36 font-mono" />
        </div>
        <p role="status" className="font-medium">
          {answer.kind === 'row'
            ? t('groups.tryRow', { status: answer.row.response.status, by, value: answer.row.value })
            : answer.kind === 'fallback'
              ? t('groups.tryFallback', { status: form.fallback.response.status, by })
              : answer.kind === 'none'
                ? t('groups.tryNone')
                : t('groups.tryEmpty', { by })}
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t(stubs === 1 ? 'groups.stubsOne' : 'groups.stubs', { count: stubs })}</span>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              {cancelLabel ?? t('common.cancel')}
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {t('editor.save')}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** One response's status, headers, body and delay. */
function ResponseFields({ id, value, onChange }: { id: string; value: ResponseForm; onChange: (r: ResponseForm) => void }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3 border-t border-line px-3 py-3 text-xs">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-status`} className="font-medium">
            {t('groups.status')}
          </label>
          <Input id={`${id}-status`} inputMode="numeric" value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })} className="h-8 w-24 font-mono" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-delay`} className="font-medium">
            {t('groups.delay')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
          </label>
          <Input id={`${id}-delay`} inputMode="numeric" value={value.delayMs} placeholder="0" onChange={(e) => onChange({ ...value, delayMs: e.target.value })} className="h-8 w-28 font-mono" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium">{t('editor.quick.responseHeaders')}</span>
        <HeaderRows label={t('editor.quick.responseHeaders')} rows={value.headers} onChange={(headers) => onChange({ ...value, headers })} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-body`} className="font-medium">
          {t('groups.body')}
        </label>
        <Textarea
          id={`${id}-body`}
          dir="ltr"
          rows={6}
          spellCheck={false}
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          className="font-mono text-xs md:text-xs"
        />
      </div>
    </div>
  )
}
