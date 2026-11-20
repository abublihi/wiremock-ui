import { cn } from '@/ui/lib/utils'

/**
 * A pulsing signal dot with a small uppercase label, for "live" things (request log, WireMock health).
 * `active={false}` shows the same chip, still and muted (paused).
 */
export function LiveDot({ label, active = true, className }: { label: string; active?: boolean; className?: string }) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-[0.14em] uppercase',
        active ? 'border-signal/25 bg-signal/5 text-signal-fg' : 'border-line bg-surface-2 text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', active ? 'status-pulse bg-signal' : 'bg-muted-foreground')} />
      {label}
    </span>
  )
}
