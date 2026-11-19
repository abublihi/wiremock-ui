import { readCookie, usePrefs } from './i18n'

export type Theme = 'light' | 'dark' | 'system'
export const THEMES: readonly Theme[] = ['light', 'dark', 'system']
export const THEME_COOKIE = 'wmui_theme'

// The theme name is also the class on <html>: `light`/`dark` force a scheme; `system` lets the
// `prefers-color-scheme` media query in styles.css decide, so the server render is already right
// and nothing flashes before hydration.

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function themeFromCookies(header: string | null | undefined): Theme {
  const value = readCookie(header, THEME_COOKIE)
  return isTheme(value) ? value : 'system'
}

export function getThemeFromRequest(request: Request): Theme {
  return themeFromCookies(request.headers.get('cookie'))
}

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const { theme, setTheme } = usePrefs()
  return { theme, setTheme }
}
