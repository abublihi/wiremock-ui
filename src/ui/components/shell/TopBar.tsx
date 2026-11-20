import { useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { MenuIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import type { PublicUser } from '@/server/users/types'
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
import { Brand } from './Brand'
import { Rail, type NavItem } from './Rail'
import { UserMenu } from './UserMenu'

export { Brand } from './Brand'

const THEME_ICON: Record<Theme, typeof SunIcon> = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

export function ThemeMenu() {
  const t = useT()
  const { theme, setTheme } = useTheme()
  const Icon = THEME_ICON[theme]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('theme.label')} className="text-muted-foreground">
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

/** Brand, navigation and the signed-in user: the desktop sidebar and the mobile nav sheet. */
export function SidebarContent({
  nav,
  user,
  onNavigate,
}: {
  nav: NavItem[]
  user: PublicUser | null
  onNavigate?: () => void
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <Rail nav={nav} onNavigate={onNavigate} />
      </div>
      {user && (
        <div className="border-t border-line/60 p-3">
          <UserMenu user={user} />
        </div>
      )}
    </>
  )
}

export function TopBar({ nav, user }: { nav: NavItem[]; user: PublicUser | null }) {
  const t = useT()
  const [navOpen, setNavOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line/60 bg-canvas/80 px-3 backdrop-blur-md md:px-8">
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="-ms-1 md:hidden" aria-label={t('shell.openNav')}>
            <MenuIcon />
          </Button>
        </SheetTrigger>
        <SheetContent side="start" className="w-[228px] gap-0 p-0">
          <SheetHeader className="border-b border-line/60 px-5 pt-5 pb-6">
            <SheetTitle className="font-normal">
              <Brand caption />
            </SheetTitle>
          </SheetHeader>
          <SidebarContent nav={nav} user={user} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <span className="md:hidden">
        <Brand />
      </span>
      {/* A shell prompt with the current path: decoration, the page title says where you are. */}
      <p aria-hidden className="hidden truncate text-[11px] text-muted-foreground md:block">
        <span className="text-signal-fg">$</span> cd ~{pathname}
      </p>
      <div className="ms-auto flex items-center gap-1">
        <ThemeMenu />
      </div>
    </header>
  )
}
