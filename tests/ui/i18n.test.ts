import { describe, expect, it } from 'vitest'
import { en } from '@/ui/i18n/en'
import { translate } from '@/ui/i18n'
import { getThemeFromRequest } from '@/ui/theme'

describe('messages', () => {
  it('interpolates variables', () => {
    expect(translate('user.signedInAs', { name: 'Sara' })).toBe('Signed in as Sara')
  })
})

describe('request preferences', () => {
  // happy-dom's Request drops the browser-forbidden Cookie header, so build the server-side shape.
  const req = (cookie?: string) => ({ headers: new Headers(cookie ? { cookie } : {}) }) as Request

  it('reads the theme cookie, defaulting to dark', () => {
    expect(getThemeFromRequest(req())).toBe('dark')
    expect(getThemeFromRequest(req('wmui_theme=dark'))).toBe('dark')
    expect(getThemeFromRequest(req('wmui_theme=purple'))).toBe('dark')
  })
})
