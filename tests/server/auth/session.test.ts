import { expect, test } from 'vitest'
import type { Config } from '../../../src/server/config'
import {
  clearSessionCookie,
  clientIp,
  isSecureRequest,
  readSessionCookie,
  sessionCookie,
  signSessionId,
} from '../../../src/server/auth/session'

const cfg = (over: Partial<Config> = {}) => ({ trustProxy: false, sessionSecret: 's3cret', ...over }) as Config
const withCookie = (value: string) => new Request('http://x/', { headers: { cookie: `a=b; wmui_session=${value}` } })

test('signed cookie round-trips; tampered signature or other secret → null', () => {
  const signed = signSessionId('abc', 's3cret')
  expect(readSessionCookie(withCookie(signed), 's3cret')).toBe('abc')
  expect(readSessionCookie(withCookie(signed.slice(0, -2) + 'xx'), 's3cret')).toBeNull()
  expect(readSessionCookie(withCookie('other.' + signed.split('.')[1]), 's3cret')).toBeNull()
  expect(readSessionCookie(withCookie(signed), 'different')).toBeNull()
  expect(readSessionCookie(withCookie('nodot'), 's3cret')).toBeNull()
  expect(readSessionCookie(new Request('http://x/'), 's3cret')).toBeNull()
})

test('Set-Cookie has HttpOnly; SameSite=Lax; Path=/; Max-Age=43200 and Secure only when asked', () => {
  const plain = sessionCookie('v', { secure: false })
  expect(plain).toContain('HttpOnly')
  expect(plain).toContain('SameSite=Lax')
  expect(plain).toContain('Path=/')
  expect(plain).toContain('Max-Age=43200')
  expect(plain).not.toContain('Secure')
  expect(sessionCookie('v', { secure: true })).toContain('; Secure')
  expect(clearSessionCookie({ secure: false })).toContain('Max-Age=0')
})

test('clientIp ignores X-Forwarded-For unless trustProxy', () => {
  const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })
  expect(clientIp(req, cfg())).toBe('unknown')
  expect(clientIp(req, cfg({ trustProxy: true }))).toBe('1.2.3.4')
  const withIp = Object.assign(new Request('http://x/'), { ip: '9.9.9.9' })
  expect(clientIp(withIp, cfg())).toBe('9.9.9.9')
})

test('isSecureRequest honours URL, trusted proxy header and https publicUiUrl', () => {
  const fwd = new Request('http://x/', { headers: { 'x-forwarded-proto': 'https' } })
  expect(isSecureRequest(fwd, cfg())).toBe(false)
  expect(isSecureRequest(fwd, cfg({ trustProxy: true }))).toBe(true)
  expect(isSecureRequest(new Request('https://x/'), cfg())).toBe(true)
  expect(isSecureRequest(new Request('http://x/'), cfg({ publicUiUrl: 'https://ui.example' }))).toBe(true)
})
