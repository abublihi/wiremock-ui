import { useMemo } from 'react'
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { cn } from '@/ui/lib/utils'

// Colours come from the design tokens, so the editor follows the light/dark theme with no JS.
const theme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--surface-2)',
    color: 'var(--ink)',
    fontSize: '12px',
    borderRadius: 'var(--radius)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--signal)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--signal)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-2)',
    color: 'var(--muted-text)',
    borderRight: '1px solid var(--line)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--signal) 5%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--signal-fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--signal) 22%, transparent) !important',
  },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in oklab, var(--signal) 18%, transparent)', outline: 'none' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--muted-text)' },
})

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.propertyName, tags.tagName], color: 'var(--signal-fg)' },
    { tag: [tags.string, tags.attributeValue], color: 'var(--ink)' },
    { tag: [tags.number, tags.bool, tags.null, tags.keyword], color: 'var(--hazard-fg)' },
    { tag: [tags.punctuation, tags.bracket, tags.separator, tags.angleBracket, tags.comment], color: 'var(--muted-text)' },
    { tag: tags.attributeName, color: 'var(--hazard-fg)' },
    { tag: tags.invalid, color: 'var(--mismatch)' },
  ]),
)

export type CodeLanguage = 'json' | 'xml'

/** A CodeMirror 6 editor styled with the app's tokens; `label` names the editable region for screen readers. */
export function CodeEditor({
  value,
  onChange,
  language,
  label,
  readOnly = false,
  invalid = false,
  minHeight = '12rem',
  maxHeight,
  className,
  describedBy,
}: {
  value: string
  onChange?: (value: string) => void
  language: CodeLanguage
  label: string
  readOnly?: boolean
  invalid?: boolean
  minHeight?: string
  maxHeight?: string
  className?: string
  describedBy?: string
}) {
  const extensions = useMemo<Extension[]>(
    () => [
      language === 'json' ? json() : xml(),
      theme,
      highlight,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
      }),
    ],
    [language, label, describedBy, invalid],
  )
  return (
    <div
      dir="ltr"
      className={cn(
        'overflow-hidden rounded-md border border-line focus-within:border-signal focus-within:ring-3 focus-within:ring-ring/30',
        invalid && 'border-mismatch',
        readOnly && 'opacity-90',
        className,
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        readOnly={readOnly}
        editable={!readOnly}
        theme="none"
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{ highlightActiveLine: !readOnly, foldGutter: true, autocompletion: false, searchKeymap: false }}
      />
    </div>
  )
}
