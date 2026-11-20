import { expect, test } from 'vitest'
import { validateTarget } from '../../../src/server/recording/target'

const refused = { wiremock: ['http://localhost:8080', 'http://wiremock.internal:8080'], app: ['http://ui.test', 'https://mocks.example.com'] }
const ok = (url: string) => validateTarget(url, refused)
const bad = (url: string) => {
  try {
    validateTarget(url, refused)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error(`accepted ${url}`)
}

test('accepts http and https base URLs, trimmed and without a trailing slash', () => {
  expect(ok(' https://api.example.com/ ')).toBe('https://api.example.com')
  expect(ok('http://api.example.com:9000/v2/')).toBe('http://api.example.com:9000/v2')
  expect(ok('HTTPS://API.Example.com')).toBe('https://api.example.com')
  // Another port on the same host as WireMock is another service.
  expect(ok('http://localhost:9090')).toBe('http://localhost:9090')
})

test('refuses other schemes, garbage, credentials, query and fragment', () => {
  expect(bad('')).toBe('Enter the target URL, like https://api.example.com')
  expect(bad('ftp://api.example.com')).toBe('Target URL must start with http:// or https://')
  expect(bad('file:///etc/passwd')).toBe('Target URL must start with http:// or https://')
  expect(bad('javascript:alert(1)')).toBe('Target URL must start with http:// or https://')
  expect(bad('api.example.com')).toBe('Target URL must start with http:// or https://')
  expect(bad('https://user:pw@api.example.com')).toBe('Target URL must not contain a user name or password')
  expect(bad('https://api.example.com/?a=1')).toBe('Target URL must not contain a query string or #fragment')
  expect(bad('https://api.example.com/#x')).toBe('Target URL must not contain a query string or #fragment')
})

test("refuses WireMock itself (any loopback spelling, default ports) and its admin API anywhere", () => {
  const self = 'Target URL is WireMock itself, so every request would loop back to WireMock. Enter the real service you want to record.'
  expect(bad('http://localhost:8080')).toBe(self)
  expect(bad('http://127.0.0.1:8080/api')).toBe(self)
  expect(bad('http://[::1]:8080')).toBe(self)
  expect(bad('http://0.0.0.0:8080')).toBe(self)
  expect(bad('http://WIREMOCK.internal:8080/')).toBe(self)
  expect(bad('https://other.example.com/__admin')).toBe('Target URL must not point at a WireMock admin API (/__admin)')
  expect(bad('https://other.example.com/x/__admin/mappings')).toBe('Target URL must not point at a WireMock admin API (/__admin)')
})

test('refuses this app', () => {
  const app = 'Target URL is this app. Enter the real service you want to record.'
  expect(bad('http://ui.test/api')).toBe(app)
  expect(bad('https://mocks.example.com:443')).toBe(app)
  expect(ok('http://mocks.example.com')).toBe('http://mocks.example.com')
})
