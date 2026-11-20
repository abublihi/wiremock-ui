/// <reference types="vite/client" />
import { type ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { Toaster } from '@/ui/components/ui/sonner'
import { TooltipProvider } from '@/ui/components/ui/tooltip'
import { PrefsProvider, usePrefsState, type Prefs } from '@/ui/i18n'
import { getThemeFromRequest, themeFromCookies } from '@/ui/theme'
import { FAVICON_HREF } from '@/ui/favicon'
import appCss from '@/ui/styles.css?url'

export function prefsFromRequest(request: Request): Prefs {
  return { theme: getThemeFromRequest(request) }
}

// Server render: the request's cookies, so the first HTML already has lang, dir and the theme class.
// In the browser: document.cookie, which the toggles below keep current.
const loadPrefs = createIsomorphicFn()
  .server((): Prefs => prefsFromRequest(getRequest()))
  .client((): Prefs => ({ theme: themeFromCookies(document.cookie) }))

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: () => ({ prefs: loadPrefs() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'wiremock-ui' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: FAVICON_HREF },
    ],
  }),
  component: RootComponent,
})

/** The html document; `head` and the body's trailing scripts come from the router in the app. */
export function RootDocument({ prefs, head, children }: { prefs: Prefs; head?: ReactNode; children: ReactNode }) {
  return (
    <html lang="en" className={prefs.theme}>
      <head>{head}</head>
      <body>{children}</body>
    </html>
  )
}

function RootComponent() {
  const { prefs, setTheme } = usePrefsState(Route.useRouteContext().prefs)

  return (
    <RootDocument prefs={prefs} head={<HeadContent />}>
      <PrefsProvider prefs={prefs} onThemeChange={setTheme}>
        <TooltipProvider>
          <Outlet />
          {/* Above the editors' sticky Save bar. */}
          <Toaster offset={{ bottom: 80 }} mobileOffset={{ bottom: 80 }} />
        </TooltipProvider>
      </PrefsProvider>
      <Scripts />
    </RootDocument>
  )
}
