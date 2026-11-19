import { describe, expect, it } from 'vitest'
import { en } from '@/ui/i18n/en'
import { ar } from '@/ui/i18n/ar'
import { getLocaleFromRequest, translate } from '@/ui/i18n'
import { getThemeFromRequest } from '@/ui/theme'

describe('messages', () => {
  it('ar.ts has every key of en.ts and no extra keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(ar)) expect(value, key).not.toBe('')
  })

  it('interpolates variables', () => {
    expect(translate('en', 'user.signedInAs', { name: 'Sara' })).toBe('Signed in as Sara')
    expect(translate('ar', 'user.signedInAs', { name: 'Sara' })).toContain('Sara')
  })
})

describe('request preferences', () => {
  // happy-dom's Request drops the browser-forbidden Cookie header, so build the server-side shape.
  const req = (cookie?: string) => ({ headers: new Headers(cookie ? { cookie } : {}) }) as Request

  it('reads the locale cookie, defaulting to en', () => {
    expect(getLocaleFromRequest(req())).toBe('en')
    expect(getLocaleFromRequest(req('a=1; wmui_lang=ar'))).toBe('ar')
    expect(getLocaleFromRequest(req('wmui_lang=fr'))).toBe('en')
  })

  it('reads the theme cookie, defaulting to system', () => {
    expect(getThemeFromRequest(req())).toBe('system')
    expect(getThemeFromRequest(req('wmui_theme=dark'))).toBe('dark')
    expect(getThemeFromRequest(req('wmui_theme=purple'))).toBe('system')
  })
})
