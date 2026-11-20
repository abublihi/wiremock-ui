import { cn } from '@/ui/lib/utils'

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'bg-signal/10 text-signal-fg border-signal/30'
  if (status >= 300 && status < 400) return 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400'
  if (status >= 400 && status < 500) return 'bg-hazard/15 text-hazard-fg border-hazard/35'
  if (status >= 500 && status < 600) return 'bg-mismatch/10 text-mismatch border-mismatch/30'
  return 'bg-muted text-muted-foreground border-border'
}

/** An HTTP status code coloured by range: 2xx signal, 3xx blue, 4xx hazard, 5xx mismatch. */
export function StatusBadge({ status, className }: { status: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 font-mono text-[11px] font-semibold tabular-nums',
        statusClass(status),
        className,
      )}
    >
      {status}
    </span>
  )
}
