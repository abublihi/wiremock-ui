/// <reference types="vite/client" />
import { useCallback, type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRoute, useRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Toaster } from '@/ui/components/ui/sonner'
import { TooltipProvider } from '@/ui/components/ui/tooltip'
import { PrefsProvider, dirOf, getLocaleFromRequest, localeFromCookies, usePrefsState, type Prefs } from '@/ui/i18n'
import { getThemeFromRequest, themeFromCookies } from '@/ui/theme'
import appCss from '@/ui/styles.css?url'

export function prefsFromRequest(request: Request): Prefs {
  return { locale: getLocaleFromRequest(request), theme: getThemeFromRequest(request) }
}

// Server render: the request's cookies, so the first HTML already has lang, dir and the theme class.
// In the browser: document.cookie, which the toggles below keep current.
const loadPrefs = createIsomorphicFn()
  .server((): Prefs => prefsFromRequest(getRequest()))
  .client((): Prefs => ({ locale: localeFromCookies(document.cookie), theme: themeFromCookies(document.cookie) }))

export const Route = createRootRoute({
  beforeLoad: () => ({ prefs: loadPrefs() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'wiremock-ui' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

/** The html document; `head` and the body's trailing scripts come from the router in the app. */
export function RootDocument({ prefs, head, children }: { prefs: Prefs; head?: ReactNode; children: ReactNode }) {
  return (
    <html lang={prefs.locale} dir={dirOf(prefs.locale)} className={prefs.theme}>
      <head>{head}</head>
      <body>{children}</body>
    </html>
  )
}

function RootComponent() {
  const router = useRouter()
  const reload = useCallback(() => void router.invalidate(), [router])
  const { prefs, setLocale, setTheme } = usePrefsState(Route.useRouteContext().prefs, reload)

  return (
    <RootDocument prefs={prefs} head={<HeadContent />}>
      <PrefsProvider prefs={prefs} onLocaleChange={setLocale} onThemeChange={setTheme}>
        <TooltipProvider>
          <Outlet />
          <Toaster />
        </TooltipProvider>
      </PrefsProvider>
      <Scripts />
    </RootDocument>
  )
}
