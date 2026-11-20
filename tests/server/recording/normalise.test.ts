import { expect, test } from 'vitest'
import { reviewItem } from '../../../src/server/recording/normalise'
import type { StubMapping } from '../../../src/server/wiremock/types'

const recorded = (over: Partial<StubMapping>): StubMapping => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  uuid: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'api_users_1',
  request: { url: '/api/users/1', method: 'GET' },
  response: { status: 200 },
  ...over,
})

test('a JSON response becomes a quick-form mock: urlPath, jsonBody, transport headers and Matched-Stub-Id dropped', () => {
  const item = reviewItem(
    recorded({
      response: {
        status: 200,
        body: '{"id":1,"name":"Ann"}',
        headers: { 'Content-Type': 'application/json', 'Matched-Stub-Id': 'x', 'Matched-Stub-Name': 'n', Date: 'today', 'Content-Length': '21', 'X-Up': 'yes' },
      },
    }),
  )
  expect(item).toEqual({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    stub: {
      name: 'GET /api/users/1',
      request: { method: 'GET', urlPath: '/api/users/1' },
      response: { status: 200, headers: { 'Content-Type': 'application/json', 'X-Up': 'yes' }, jsonBody: { id: 1, name: 'Ann' } },
    },
    method: 'GET',
    url: '/api/users/1',
    status: 200,
    bodySize: 21,
    contentType: 'application/json',
    matchedStubId: 'x',
  })
})

test('a base64 body that is UTF-8 text becomes body; real binary stays base64 with a Content-Type', () => {
  const text = reviewItem(recorded({ response: { status: 200, base64Body: Buffer.from('héllo').toString('base64') } }))
  expect(text.stub.response).toEqual({ status: 200, body: 'héllo' })
  expect(text.bodySize).toBe(6)
  const bin = Buffer.from([0, 1, 2, 255]).toString('base64')
  const binary = reviewItem(recorded({ response: { status: 200, base64Body: bin } }))
  expect(binary.stub.response).toEqual({ status: 200, base64Body: bin, headers: { 'Content-Type': 'application/octet-stream' } })
  expect(binary.bodySize).toBe(4)
  const empty = reviewItem(recorded({ response: { status: 204, body: '' } }))
  expect(empty.stub.response).toEqual({ status: 204 })
})

test('query string → queryParameters; JSON body pattern without ignoreArrayOrder; scenario fields and captured headers kept', () => {
  const item = reviewItem(
    recorded({
      name: 'search',
      request: {
        urlPath: '/search',
        queryParameters: { q: { hasExactly: [{ equalTo: 'a b' }] }, page: { hasExactly: [{ equalTo: '2' }] } },
        method: 'POST',
        headers: { Accept: { equalTo: 'application/json' } },
        bodyPatterns: [{ equalToJson: '{"x":[1,2]}', ignoreArrayOrder: true, ignoreExtraElements: true }],
      },
      scenarioName: 'scenario-1-search',
      requiredScenarioState: 'Started',
      newScenarioState: 'scenario-1-search-2',
    }),
  )
  expect(item.stub).toEqual({
    name: 'POST /search',
    request: {
      method: 'POST',
      urlPath: '/search',
      queryParameters: { q: { equalTo: 'a b' }, page: { equalTo: '2' } },
      headers: { Accept: { equalTo: 'application/json' } },
      bodyPatterns: [{ equalToJson: '{"x":[1,2]}', ignoreExtraElements: true }],
    },
    response: { status: 200 },
    scenarioName: 'scenario-1-search',
    requiredScenarioState: 'Started',
    newScenarioState: 'scenario-1-search-2',
  })
  expect(item.url).toBe('/search?q=a+b&page=2')
})

test('a repeated query parameter keeps its hasExactly list; a url with a query stays a url matcher', () => {
  const repeated = { hasExactly: [{ equalTo: '1' }, { equalTo: '2' }] }
  const item = reviewItem(recorded({ request: { urlPath: '/s', method: 'GET', queryParameters: { a: repeated } } }))
  expect(item.stub.request).toEqual({ method: 'GET', urlPath: '/s', queryParameters: { a: repeated } })
  expect(item.url).toBe('/s?a=1&a=2')
  expect(reviewItem(recorded({ request: { url: '/s?a=1', method: 'GET' } })).stub.request).toEqual({ method: 'GET', url: '/s?a=1' })
})

test('JSON under a JSON Content-Type that does not parse stays a text body', () => {
  const item = reviewItem(recorded({ response: { status: 500, body: 'oops', headers: { 'content-type': 'application/json; charset=utf-8' } } }))
  expect(item.stub.response).toEqual({ status: 500, body: 'oops', headers: { 'content-type': 'application/json; charset=utf-8' } })
})
