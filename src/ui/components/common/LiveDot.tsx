import { cn } from '@/ui/lib/utils'

/** A pulsing signal dot with a small uppercase label, for "live" things (request log, WireMock health). */
export function LiveDot({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-signal/25 bg-signal/5 px-2.5 py-0.5 text-[10px] font-medium tracking-[0.14em] text-signal-fg uppercase',
        className,
      )}
    >
      <span aria-hidden className="status-pulse size-1.5 rounded-full bg-signal" />
      {label}
    </span>
  )
}
