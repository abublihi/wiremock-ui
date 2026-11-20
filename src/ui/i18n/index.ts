import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { en } from './en'
import { THEME_COOKIE, type Theme } from '../theme'

// English only: strings still live in one file so copy stays reviewable in one place.
export type MessageKey = keyof typeof en
export type Prefs = { theme: Theme }

const ONE_YEAR = 60 * 60 * 24 * 365

/** Reads one cookie from a `Cookie` header (or `document.cookie`) string. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return undefined // malformed value: fall back to the default rather than fail the render
    }
  }
  return undefined
}

/** Writes a long-lived, site-wide preference cookie (client only). */
export function writePrefCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`
}

export function translate(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = en[key]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

/** The app's live theme preference: each change writes its cookie (so the next server render matches). */
export function usePrefsState(initial: Prefs) {
  const [prefs, setPrefs] = useState<Prefs>(initial)
  const setTheme = useCallback((theme: Theme) => {
    writePrefCookie(THEME_COOKIE, theme)
    setPrefs({ theme })
  }, [])
  return { prefs, setTheme }
}

type PrefsContextValue = Prefs & { setTheme: (theme: Theme) => void }

export const PrefsContext = createContext<PrefsContextValue | null>(null)

export function usePrefs(): PrefsContextValue {
  const value = useContext(PrefsContext)
  if (!value) throw new Error('usePrefs must be used inside <PrefsProvider>')
  return value
}

/** The theme for the whole app. The owner (the root route) persists changes; tests pass a no-op. */
export function PrefsProvider({
  prefs,
  onThemeChange,
  children,
}: {
  prefs: Prefs
  onThemeChange: (theme: Theme) => void
  children: ReactNode
}) {
  const value = useMemo(() => ({ ...prefs, setTheme: onThemeChange }), [prefs, onThemeChange])
  return createElement(PrefsContext.Provider, { value }, children)
}

export function useT(): (key: MessageKey, vars?: Record<string, string | number>) => string {
  return translate
}
