import { DownloadIcon, FileArchiveIcon, FileJsonIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu'
import { useT } from '@/ui/i18n'
import { exportUrl, type ExportScope } from '@/ui/lib/export'

/** Download the mocks in scope as a bundle (re-importable here) or as WireMock mapping files (a zip). */
export function ExportMenu({ scope }: { scope: ExportScope }) {
  const t = useT()
  const label =
    scope.scope === 'tag'
      ? t('export.scopeTag', { tag: scope.tag })
      : t(scope.scope === 'mine' ? 'export.scopeMine' : 'export.scopeAll')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <DownloadIcon data-icon="inline-start" />
          {t('export.button')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className="font-mono text-[11px] text-muted-foreground">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={exportUrl(scope, 'bundle')} download>
            <FileJsonIcon data-icon="inline-start" />
            <span className="flex flex-col">
              <span>{t('export.bundle')}</span>
              <span className="text-[11px] text-muted-foreground">{t('export.bundleHint')}</span>
            </span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={exportUrl(scope, 'mappings')} download>
            <FileArchiveIcon data-icon="inline-start" />
            <span className="flex flex-col">
              <span>{t('export.mappings')}</span>
              <span className="text-[11px] text-muted-foreground">{t('export.mappingsHint')}</span>
            </span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
