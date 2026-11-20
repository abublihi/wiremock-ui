import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { useT } from '@/ui/i18n'
import type { HeaderRow } from '@/ui/lib/editor-sync'

/** Header name/value rows with add and remove; `label` names the list for screen readers. */
export function HeaderRows({
  label,
  rows,
  invalid,
  describedBy,
  addLabel,
  onChange,
}: {
  label: string
  /** The add button's text (default "Add header"). */
  addLabel?: string
  rows: HeaderRow[]
  invalid?: boolean
  describedBy?: string
  onChange: (rows: HeaderRow[]) => void
}) {
  const t = useT()
  const update = (i: number, patch: Partial<HeaderRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  // Header names ignore case; a stub keeps one value per name, so a repeated name loses all but one.
  const names = rows.map((r) => r.name.trim().toLowerCase()).filter(Boolean)
  const repeated = rows.find((r) => r.name.trim() !== '' && names.indexOf(r.name.trim().toLowerCase()) !== names.lastIndexOf(r.name.trim().toLowerCase()))
  return (
    <div className="flex flex-col gap-1.5">
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={label}>
          {rows.map((row, i) => (
            // Controlled inputs: an index key keeps every value right when a row is removed.
            <li key={i} className="flex items-center gap-1.5">
              <Input
                aria-label={`${label}: ${t('editor.headers.name')}`}
                placeholder={t('editor.headers.name')}
                value={row.name}
                aria-invalid={invalid && row.name.trim() === '' ? true : undefined}
                aria-describedby={describedBy}
                spellCheck={false}
                autoComplete="off"
                dir="ltr"
                className="h-8 w-2/5 font-mono text-xs"
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <Input
                aria-label={`${label}: ${row.name.trim() || t('editor.headers.value')}`}
                placeholder={t('editor.headers.value')}
                value={row.value}
                spellCheck={false}
                autoComplete="off"
                dir="ltr"
                className="h-8 min-w-0 flex-1 font-mono text-xs"
                onChange={(e) => update(i, { value: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={row.name.trim() ? t('editor.headers.remove', { name: row.name.trim() }) : t('editor.headers.removeRow')}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {repeated && (
        <p role="note" className="text-xs text-hazard-fg">
          {t('editor.headers.duplicate', { name: repeated.name.trim() })}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="w-fit text-muted-foreground hover:text-signal-fg"
        onClick={() => onChange([...rows, { name: '', value: '' }])}
      >
        <PlusIcon data-icon="inline-start" />
        {addLabel ?? t('editor.headers.add')}
      </Button>
    </div>
  )
}

/** A row with a value but no name can't be sent. */
export const hasUnnamedRow = (rows: HeaderRow[]) => rows.some((r) => r.name.trim() === '' && r.value !== '')
