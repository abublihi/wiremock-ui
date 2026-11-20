import { cn } from '@/ui/lib/utils'

// The only place palette colours (not tokens) are allowed: the HTTP method colours are a convention
// people read at a glance. Light uses the -700 shade for 4.5:1 text contrast; dark the -400.
const METHOD_CLASS: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  POST: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400',
  PUT: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400',
  PATCH: 'bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-400',
  DELETE: 'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400',
}
const MUTED = 'bg-muted text-muted-foreground border-border'

/** An HTTP method as a tinted mono chip; unknown methods (OPTIONS, HEAD, ANY…) are muted. */
export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const name = method.toUpperCase()
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 font-mono text-[11px] font-semibold tracking-wide transition-shadow hover:shadow-[0_0_8px_-1px_currentColor]',
        METHOD_CLASS[name] ?? MUTED,
        className,
      )}
    >
      {name}
    </span>
  )
}
