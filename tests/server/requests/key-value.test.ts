import { expect, test } from 'vitest'
import { requestKeyValue } from '../../../src/server/requests/explain'
import type { LoggedRequest } from '../../../src/server/wiremock/types'

const req = (r: Partial<LoggedRequest> = {}): LoggedRequest => ({ method: 'POST', url: '/x', ...r })

test('reads the key from a JSON body by JSONPath', () => {
  expect(requestKeyValue({ location: 'jsonPath', expression: '$.idNo' }, '/x', req({ body: '{"idNo":"999"}' }))).toBe('999')
  expect(requestKeyValue({ location: 'jsonPath', expression: '$.a.n' }, '/x', req({ body: '{"a":{"n":7}}' }))).toBe('7')
  expect(requestKeyValue({ location: 'jsonPath', expression: '$.idNo' }, '/x', req({ body: 'not json' }))).toBeNull()
  expect(requestKeyValue({ location: 'jsonPath', expression: '$.idNo' }, '/x', req({ body: '{}' }))).toBeNull()
})

test('reads the key from the query, a header, a form field and the path', () => {
  expect(requestKeyValue({ location: 'query', expression: 'id' }, '/x', req({ url: '/x?id=p-2&b=1' }))).toBe('p-2')
  expect(requestKeyValue({ location: 'header', expression: 'X-Id' }, '/x', req({ headers: { 'x-id': 'h1' } }))).toBe('h1')
  expect(
    requestKeyValue(
      { location: 'form', expression: 'id' },
      '/x',
      req({ headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'id=f%201&z=2' }),
    ),
  ).toBe('f 1')
  expect(requestKeyValue({ location: 'path', expression: 'paymentId' }, '/pay/payments/{paymentId}', req({ url: '/pay/payments/p-9?x=1' }))).toBe('p-9')
  expect(requestKeyValue({ location: 'path', expression: 'paymentId' }, '/pay/payments/{paymentId}', req({ url: '/other' }))).toBeNull()
  expect(requestKeyValue({ location: 'query', expression: 'id' }, '/x', req({ url: '/x' }))).toBeNull()
})

test('reads a simple XPath element and gives up on anything else', () => {
  const xml = '<req><citizen><idNo>42</idNo></citizen></req>'
  expect(requestKeyValue({ location: 'xPath', expression: '//idNo' }, '/x', req({ body: xml }))).toBe('42')
  expect(requestKeyValue({ location: 'xPath', expression: '/req/citizen/idNo/text()' }, '/x', req({ body: xml }))).toBe('42')
  expect(requestKeyValue({ location: 'xPath', expression: 'count(//idNo)' }, '/x', req({ body: xml }))).toBeNull()
})
