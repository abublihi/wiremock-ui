import { createFileRoute } from '@tanstack/react-router'
import { useT } from '@/ui/i18n'

// Placeholder so sign-in has somewhere to land; the mock list replaces it.
export const Route = createFileRoute('/_app/mocks/')({ component: MocksPlaceholder })

function MocksPlaceholder() {
  const t = useT()
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">
        {t('mocks.placeholderTitle')}
      </h1>
      <p className="text-xs text-muted-foreground">{t('mocks.placeholderBody')}</p>
    </div>
  )
}
