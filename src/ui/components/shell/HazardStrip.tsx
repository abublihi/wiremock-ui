import { useT } from '@/ui/i18n'

/** The signature 6 px hazard strip across the top of every page, with its label on a solid chip. */
export function HazardStrip() {
  const t = useT()
  return (
    <div role="note" className="relative z-40 flex shrink-0 flex-col items-center">
      <div aria-hidden className="hatch h-1.5 w-full" />
      <span className="mx-4 -mt-px rounded-b-md border border-t-0 border-hazard/70 bg-surface px-3 py-0.5 text-center text-[10px] leading-4 font-medium text-ink md:absolute md:top-1.5 md:tracking-[0.08em]">
        {t('hazard.label')}
      </span>
    </div>
  )
}
