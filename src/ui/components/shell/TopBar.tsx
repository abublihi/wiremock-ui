import { useState } from 'react'
import { MenuIcon, MonitorIcon, MoonIcon, SunIcon, WaypointsIcon } from 'lucide-react'
import type { PublicUser } from '@/server/users/types'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet'
import { useT } from '@/ui/i18n'
import { THEMES, isTheme, useTheme, type Theme } from '@/ui/theme'
import { Rail, type NavItem } from './Rail'

const THEME_ICON: Record<Theme, typeof SunIcon> = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

export function Brand() {
  const t = useT()
  return (
    <span dir="ltr" className="inline-flex items-center gap-2 font-condensed text-base font-semibold text-ink">
      <span aria-hidden className="flex size-5 items-center justify-center rounded-sm bg-signal text-primary-foreground">
        <WaypointsIcon className="size-3.5" />
      </span>
      {t('app.name')}
    </span>
  )
}

function ThemeMenu() {
  const t = useT()
  const { theme, setTheme } = useTheme()
  const Icon = THEME_ICON[theme]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('theme.label')}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => isTheme(v) && setTheme(v)}>
          {THEMES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(`theme.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TopBar({ nav, user }: { nav: NavItem[]; user: PublicUser | null }) {
  const t = useT()
  const [navOpen, setNavOpen] = useState(false)
  return (
    <header className="flex h-14 items-center gap-2 border-b bg-surface px-3 md:px-4">
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('shell.openNav')}>
            <MenuIcon />
          </Button>
        </SheetTrigger>
        <SheetContent side="start" className="w-64 gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>
              <Brand />
            </SheetTitle>
          </SheetHeader>
          <Rail nav={nav} user={user} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <Brand />
      <div className="ms-auto flex items-center gap-1">
        <ThemeMenu />
        {user && (
          <div className="flex items-center gap-2 ps-2" title={t('user.signedInAs', { name: user.displayName })}>
            <span className="hidden max-w-40 truncate font-medium sm:inline">{user.displayName}</span>
            <Badge variant="secondary">{t(`role.${user.role}`)}</Badge>
          </div>
        )}
      </div>
    </header>
  )
}
