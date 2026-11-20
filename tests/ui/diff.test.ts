import { describe, expect, it } from 'vitest'
import type { FieldDiff } from '@/server/requests/explain'
import type { LoggedEvent } from '@/server/wiremock/types'
import { diffRows, diffSummary } from '@/ui/lib/diff'
import { stubFromRequest } from '@/ui/lib/prefill'

const d = (field: string, matched: boolean | null): FieldDiff => ({ field, expected: `equalTo ${field}`, actual: field, matched })

describe('diffRows', () => {
  it('maps true / false / null to match / mismatch / unchecked', () => {
    const rows = diffRows([d('method', true), d('urlPath', false), d('body', null)])
    expect(Object.fromEntries(rows.map((r) => [r.field, r.state]))).toEqual({ method: 'match', urlPath: 'mismatch', body: 'unchecked' })
  })

  it('sorts mismatches first and keeps the order of the rest', () => {
    const rows = diffRows([d('method', true), d('urlPath', false), d('body', null), d('header.a', true), d('query.q', false)])
    expect(rows.map((r) => r.field)).toEqual(['urlPath', 'query.q', 'method', 'body', 'header.a'])
  })

  it('counts each state', () => {
    expect(diffSummary(diffRows([d('a', true), d('b', false), d('c', false), d('d', null)]))).toEqual({
      total: 4,
      match: 1,
      mismatch: 2,
      unchecked: 1,
    })
  })
})

const event = (request: Partial<LoggedEvent['request']>): LoggedEvent => ({
  id: 'r1',
  wasMatched: false,
  request: { url: '/pay/charge?x=1', method: 'POST', ...request },
})

describe('stubFromRequest', () => {
  it('uses the method and the path without its query', () => {
    expect(stubFromRequest(event({ method: 'GET', body: '' }))).toEqual({
      request: { method: 'GET', urlPath: '/pay/charge' },
      response: { status: 200 },
    })
  })

  it('adds an equalToJson body pattern when the body is JSON', () => {
    expect(stubFromRequest(event({ body: '{"amount": 12, "items": [1]}' }))).toEqual({
      request: {
        method: 'POST',
        urlPath: '/pay/charge',
        bodyPatterns: [{ equalToJson: JSON.stringify({ amount: 12, items: [1] }, null, 2), ignoreExtraElements: true }],
      },
      response: { status: 200 },
    })
  })

  it('leaves non-JSON and scalar bodies out', () => {
    expect(stubFromRequest(event({ body: 'amount=12' })).request).not.toHaveProperty('bodyPatterns')
    expect(stubFromRequest(event({ body: '42' })).request).not.toHaveProperty('bodyPatterns')
  })
})
