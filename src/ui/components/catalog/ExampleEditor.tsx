import { lazy, Suspense } from 'react'
import type { Endpoint } from '@/server/catalog/types'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Textarea } from '@/ui/components/ui/textarea'

// CodeMirror is heavy: it loads when the first example editor opens, not with the catalog page.
const CodeEditor = lazy(() => import('@/ui/components/editor/CodeEditor').then((m) => ({ default: m.CodeEditor })))

/** An example body: CodeMirror for JSON and XML, a plain mono textarea for text and HTML. */
export function ExampleEditor({
  value,
  onChange,
  contentType,
  label,
  invalid,
  describedBy,
}: {
  value: string
  onChange: (value: string) => void
  contentType: Endpoint['contentType']
  label: string
  invalid?: boolean
  describedBy?: string
}) {
  if (contentType === 'json' || contentType === 'xml') {
    return (
      <Suspense fallback={<Skeleton className="h-24 w-full" />}>
        <CodeEditor
          value={value}
          onChange={onChange}
          language={contentType}
          label={label}
          invalid={invalid}
          describedBy={describedBy}
          minHeight="6rem"
          maxHeight="16rem"
        />
      </Suspense>
    )
  }
  return (
    <Textarea
      dir="ltr"
      className="min-h-24 font-mono text-xs md:text-xs"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
