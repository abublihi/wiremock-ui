import { createFileRoute } from '@tanstack/react-router'
import { ImportPanel } from '@/ui/components/admin/ImportPanel'
import { ExportMenu } from '@/ui/components/mocks/ExportMenu'
import { useT } from '@/ui/i18n'

export const Route = createFileRoute('/_app/import')({ component: ImportPage })

export function ImportPage() {
  const t = useT()
  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('import.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('import.caption')}</p>
        </div>
        <ExportMenu scope={{ scope: 'all' }} />
      </header>
      <p className="max-w-3xl text-xs text-muted-foreground">{t('import.ownership')}</p>
      <ImportPanel />
    </div>
  )
}
