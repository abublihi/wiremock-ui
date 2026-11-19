import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { Direction } from 'radix-ui'
import { en } from './en'
import { ar } from './ar'
import type { Theme } from '../theme'

export type Locale = 'en' | 'ar'
export type Dir = 'ltr' | 'rtl'
export type MessageKey = keyof typeof en
export type Prefs = { locale: Locale; theme: Theme }

export const LOCALE_COOKIE = 'wmui_lang'
const ONE_YEAR = 60 * 60 * 24 * 365

const messages: Record<Locale, Record<MessageKey, string>> = { en, ar }

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ar'
}

export function dirOf(locale: Locale): Dir {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

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

export function localeFromCookies(header: string | null | undefined): Locale {
  const value = readCookie(header, LOCALE_COOKIE)
  return isLocale(value) ? value : 'en'
}

export function getLocaleFromRequest(request: Request): Locale {
  return localeFromCookies(request.headers.get('cookie'))
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = messages[locale][key] ?? en[key]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

type PrefsContextValue = Prefs & {
  setLocale: (locale: Locale) => void
  setTheme: (theme: Theme) => void
}

export const PrefsContext = createContext<PrefsContextValue | null>(null)

export function usePrefs(): PrefsContextValue {
  const value = useContext(PrefsContext)
  if (!value) throw new Error('usePrefs must be used inside <PrefsProvider>')
  return value
}

/**
 * Locale + theme for the whole app, and the document direction for Radix primitives.
 * The owner (the root route) persists changes; tests pass no-op handlers.
 */
export function PrefsProvider({
  prefs,
  onLocaleChange,
  onThemeChange,
  children,
}: {
  prefs: Prefs
  onLocaleChange: (locale: Locale) => void
  onThemeChange: (theme: Theme) => void
  children: ReactNode
}) {
  const value = useMemo(
    () => ({ ...prefs, setLocale: onLocaleChange, setTheme: onThemeChange }),
    [prefs, onLocaleChange, onThemeChange],
  )
  return createElement(
    PrefsContext.Provider,
    { value },
    createElement(Direction.Provider, { dir: dirOf(prefs.locale) }, children),
  )
}

export function useLocale(): { locale: Locale; dir: Dir; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = usePrefs()
  return { locale, dir: dirOf(locale), setLocale }
}

export function useT(): (key: MessageKey, vars?: Record<string, string | number>) => string {
  const { locale } = usePrefs()
  return useCallback((key, vars) => translate(locale, key, vars), [locale])
}
