import { expect, test } from 'vitest'
import { isLoopbackHost, validateTarget } from '../../../src/server/recording/target'

const LOOP = 'Target URL is WireMock itself, so every request would loop back to WireMock. Enter the real service you want to record.'
const APP = 'Target URL is this app. Enter the real service you want to record.'

const check = (refused: { wiremock: string[]; app: string[] }) => ({
  ok: (url: string) => validateTarget(url, refused),
  bad: (url: string) => {
    try {
      validateTarget(url, refused)
    } catch (err) {
      return (err as Error).message
    }
    throw new Error(`accepted ${url}`)
  },
})

const local = check({ wiremock: ['http://localhost:8080', 'http://wiremock.internal:8080'], app: ['http://ui.test', 'https://mocks.example.com'] })
// The default Compose setup: the UI reaches WireMock by its service name, WireMock itself listens on 8080.
const compose = check({ wiremock: ['http://wiremock:8080'], app: ['http://localhost:3000'] })

test('accepts http and https base URLs, trimmed and without a trailing slash', () => {
  expect(local.ok(' https://api.example.com/ ')).toBe('https://api.example.com')
  expect(local.ok('http://api.example.com:9000/v2/')).toBe('http://api.example.com:9000/v2')
  expect(local.ok('HTTPS://API.Example.com')).toBe('https://api.example.com')
  // Another port on WireMock's machine is another service.
  expect(local.ok('http://localhost:9090')).toBe('http://localhost:9090')
  expect(compose.ok('http://upstream:8080')).toBe('http://upstream:8080')
  expect(compose.ok('http://wiremock:9000')).toBe('http://wiremock:9000')
})

test('refuses other schemes, garbage, credentials, query and fragment', () => {
  expect(local.bad('')).toBe('Enter the target URL, like https://api.example.com')
  expect(local.bad('ftp://api.example.com')).toBe('Target URL must start with http:// or https://')
  expect(local.bad('file:///etc/passwd')).toBe('Target URL must start with http:// or https://')
  expect(local.bad('javascript:alert(1)')).toBe('Target URL must start with http:// or https://')
  expect(local.bad('api.example.com')).toBe('Target URL must start with http:// or https://')
  expect(local.bad('https://user:pw@api.example.com')).toBe('Target URL must not contain a user name or password')
  expect(local.bad('https://api.example.com/?a=1')).toBe('Target URL must not contain a query string or #fragment')
  expect(local.bad('https://api.example.com/#x')).toBe('Target URL must not contain a query string or #fragment')
})

test("refuses WireMock itself by its URLs and its admin API anywhere", () => {
  expect(local.bad('http://WIREMOCK.internal:8080/')).toBe(LOOP)
  expect(compose.bad('http://wiremock:8080/api')).toBe(LOOP)
  expect(local.bad('https://other.example.com/__admin')).toBe('Target URL must not point at a WireMock admin API (/__admin)')
  expect(local.bad('https://other.example.com/x/__admin/mappings')).toBe('Target URL must not point at a WireMock admin API (/__admin)')
})

test('a loopback or unspecified host on WireMock\'s port is WireMock itself, whatever WIREMOCK_URL calls it', () => {
  for (const url of [
    'http://localhost:8080',
    'http://LOCALHOST.:8080',
    'http://api.localhost:8080',
    'http://127.0.0.1:8080',
    'http://127.1:8080',
    'http://127.200.3.4:8080/x',
    'http://2130706433:8080',
    'http://0x7f.0.0.1:8080',
    'http://[::1]:8080',
    'http://[0:0:0:0:0:0:0:1]:8080',
    'http://[::ffff:127.0.0.1]:8080',
    'http://0.0.0.0:8080',
    'http://0:8080',
    'http://[::]:8080',
    'http://[::ffff:0.0.0.0]:8080',
  ]) {
    expect(compose.bad(url), url).toBe(LOOP)
  }
  // https on WireMock's port as well; another port is not WireMock.
  expect(compose.bad('https://localhost:8080')).toBe(LOOP)
  expect(compose.ok('http://127.0.0.1:9999')).toBe('http://127.0.0.1:9999')
  // Default ports: a WIREMOCK_URL without a port listens on 80.
  expect(check({ wiremock: ['http://wiremock'], app: [] }).bad('http://localhost')).toBe(LOOP)
})

test('refuses this app: its URLs, and a loopback host on its port', () => {
  expect(local.bad('http://ui.test/api')).toBe(APP)
  expect(local.bad('https://mocks.example.com:443')).toBe(APP)
  expect(local.ok('http://mocks.example.com')).toBe('http://mocks.example.com')
  expect(compose.bad('http://127.0.0.1:3000')).toBe(APP)
  expect(compose.bad('http://localhost:3000/api')).toBe(APP)
})

test('isLoopbackHost', () => {
  const is = (u: string) => isLoopbackHost(new URL(u))
  expect(is('http://localhost')).toBe(true)
  expect(is('http://[::ffff:7f00:1]')).toBe(true)
  expect(is('http://[::ffff:a00:1]')).toBe(false)
  expect(is('http://10.0.0.1')).toBe(false)
  expect(is('http://localhost.example.com')).toBe(false)
  expect(is('http://128.0.0.1')).toBe(false)
})
