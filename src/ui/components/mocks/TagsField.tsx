import { useId, useState } from 'react'
import { XIcon } from 'lucide-react'
import { MAX_TAGS, normaliseTag, tagProblem } from '@/server/mocks/tags'
import { useT } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'

/** A tag as a small pill; `onRemove` adds its × button. */
export function TagChip({ tag, onRemove, className }: { tag: string; onRemove?: () => void; className?: string }) {
  const t = useT()
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-signal/10 px-2 py-0.5 font-mono text-[11px] text-signal-fg', className)}>
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('tags.remove', { tag })}
          className="-me-1 rounded-full p-0.5 hover:bg-signal/20 focus-visible:outline-2 focus-visible:outline-signal"
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      )}
    </span>
  )
}

/**
 * Edits a list of tags: chips with ×, and a text box that adds a tag on Enter, comma or leaving it. Tags are shown as
 * they are stored (lower case, spaces as `-`); one that can't be stored is explained instead of added.
 */
export function TagsField({
  tags,
  onChange,
  suggestions = [],
  label,
  compact,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  /** Tags already in use, offered while typing. */
  suggestions?: string[]
  /** The field's visible label (default "Tags"). */
  label?: string
  /** No visible label (the caller labels it). */
  compact?: boolean
}) {
  const t = useT()
  const ids = useId()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const full = tags.length >= MAX_TAGS

  const add = (raw: string) => {
    const parts = raw.split(',')
    let next = tags
    for (const part of parts) {
      const tag = normaliseTag(part)
      if (tag === null) continue
      const why = tagProblem(tag)
      if (why) {
        setProblem(t('tags.invalid', { tag }))
        return
      }
      if (next.length >= MAX_TAGS) {
        setProblem(t('tags.tooMany', { max: MAX_TAGS }))
        break
      }
      if (!next.includes(tag)) next = [...next, tag]
    }
    setText('')
    if (next !== tags) {
      setProblem(null)
      onChange(next)
    }
  }

  const offered = suggestions.filter((s) => !tags.includes(s))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor={`${ids}-input`} className={cn('text-xs font-medium', compact && 'sr-only')}>
          {label ?? t('tags.label')}
        </label>
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} onRemove={() => onChange(tags.filter((x) => x !== tag))} />
        ))}
        <input
          id={`${ids}-input`}
          list={offered.length > 0 ? `${ids}-list` : undefined}
          value={text}
          disabled={full}
          placeholder={full ? t('tags.full') : t('tags.placeholder')}
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${ids}-problem` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setProblem(null)
            const value = e.target.value
            // A comma ends a tag (also when one is pasted with commas).
            if (value.includes(',')) add(value)
            else setText(value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && text === '' && tags.length > 0) onChange(tags.slice(0, -1))
          }}
          onBlur={() => text.trim() && add(text)}
          className="h-6 min-w-28 flex-1 rounded-full border border-dashed border-line bg-transparent px-2.5 font-mono text-[11px] outline-none placeholder:text-muted-foreground focus-visible:border-signal aria-invalid:border-mismatch"
        />
        {offered.length > 0 && (
          <datalist id={`${ids}-list`}>
            {offered.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </div>
      {problem && (
        <p id={`${ids}-problem`} role="alert" className="text-[11px] text-mismatch">
          {problem}
        </p>
      )}
    </div>
  )
}
