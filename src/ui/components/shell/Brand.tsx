import { useT } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'

/** The mark: a client dot wired to a stub card. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="5" cy="12" r="2.25" />
      <path d="M7.5 12h3.5" strokeDasharray="1.5 1.5" />
      <rect x="11.5" y="6.5" width="9" height="11" rx="1.75" />
      <path d="M14 10h4M14 12.75h2.5" strokeLinecap="round" />
      <circle cx="18" cy="15" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * The wordmark: outlined signal tile + `wiremock-ui_` with a blinking cursor, and optionally the
 * `// WireMock mock console` caption under it. `size="lg"` is the login page's glowing version.
 */
export function Brand({ caption = false, size = 'sm' }: { caption?: boolean; size?: 'sm' | 'lg' }) {
  const t = useT()
  const lg = size === 'lg'
  return (
    <span dir="ltr" className="inline-flex flex-col gap-2">
      <span className="inline-flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md border border-signal/30 bg-signal/10 text-signal-fg',
            lg ? 'size-10' : 'size-8',
          )}
        >
          <Mark className={lg ? 'size-6' : 'size-5'} />
        </span>
        <span
          className={cn(
            'inline-flex items-baseline leading-none font-semibold tracking-tight text-ink',
            lg ? 'glow-text text-xl' : 'text-sm',
          )}
        >
          {t('app.name')}
          <span aria-hidden className="cursor-blink font-medium text-signal-fg">
            _
          </span>
        </span>
      </span>
      {caption && (
        <span className={cn('text-[10px] leading-none text-muted-foreground', lg ? 'ps-[50px]' : 'ps-[42px]')}>
          {t('app.caption')}
        </span>
      )}
    </span>
  )
}
