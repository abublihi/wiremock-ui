import { useT } from '@/ui/i18n'
import { cn } from '@/ui/lib/utils'

/**
 * The request log's signature: a hatched amber "No match" stamp — the hazard hatch as a frame around a
 * readable label (the hatch's second and last use, after the test-environment strip). With `onClick` it is a
 * button that opens the near-miss explanation.
 */
export function NoMatchStamp({ onClick, size = 'sm', className }: { onClick?: () => void; size?: 'sm' | 'lg'; className?: string }) {
  const t = useT()
  const label = (
    <span
      className={cn(
        'flex items-center rounded-[2px] bg-surface font-bold tracking-[0.16em] text-hazard-fg uppercase',
        size === 'sm' ? 'h-4 px-1.5 text-[9.5px]' : 'h-6 px-2.5 text-[11px]',
      )}
    >
      {t('requests.noMatch')}
    </span>
  )
  const frame = cn(
    'hatch inline-flex shrink-0 rounded-[3px] p-[2px] shadow-[0_0_0_1px_var(--hazard)]',
    size === 'lg' && '-rotate-2 p-1',
    className,
  )
  if (!onClick) return <span className={frame}>{label}</span>
  return (
    <button
      type="button"
      aria-label={t('requests.noMatchExplain')}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(frame, 'cursor-pointer transition-[transform,box-shadow] hover:-rotate-2 hover:shadow-[0_0_0_1px_var(--hazard),0_0_14px_-2px_var(--hazard)]')}
    >
      {label}
    </button>
  )
}
