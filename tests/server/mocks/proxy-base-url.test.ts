import { expect, test } from 'vitest'
import { normalisePowerFields } from '../../../src/server/mocks/power-fields'

test('a proxy base URL loses its trailing slashes (no // in forwarded paths)', () => {
  const stub = { request: {}, response: { proxyBaseUrl: ' https://api.example.com/v1// ' } }
  expect(normalisePowerFields(stub).response.proxyBaseUrl).toBe('https://api.example.com/v1')
  const same = { request: {}, response: { proxyBaseUrl: 'https://api.example.com' } }
  expect(normalisePowerFields(same)).toBe(same)
})
