import { describe, expect, it } from 'vitest'
import { emptyBundle } from '@/server/bundle/shape'
import { buildGroupStubs } from '@/server/mocks/groups'
import type { StubMapping } from '@/server/wiremock/types'
import { emptyQuickForm } from '@/ui/lib/editor-sync'
import { addFirstRow, groupInputFrom, noResponses, responsesFromStubs, responsesProblems, rowLabel, suggestBy, withValuesRow } from '@/ui/lib/groups'
import { combineStubs, findCombinable, groupForReview, initialReview, reviewedBundle } from '@/ui/lib/import-review'

const stored = (stubs: ReturnType<typeof buildGroupStubs>) => stubs.map((s, i) => ({ id: `s${i}`, ...s }) as unknown as StubMapping)

describe('a mock with several responses in the editor', () => {
  const input = {
    name: 'Est',
    tags: ['qiwa'],
    priority: 3,
    request: { method: 'GET' as const, urlType: 'template' as const, url: '/est/{office}/{seq}', query: { lang: 'en' } },
    by: [{ location: 'path' as const, expression: 'seq' }],
    responses: [
      { values: ['1'], response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{\n  "ok": true\n}' } },
      { values: ['2'], response: { status: 201, headers: { 'Content-Type': 'text/plain' }, body: 'plain', delayMs: 2000 } },
    ],
    fallback: { response: { status: 404, headers: { 'Content-Type': 'text/plain' } } },
  }
  const roundTrip = (i: Parameters<typeof buildGroupStubs>[0]) => {
    const read = responsesFromStubs(stored(buildGroupStubs(i, 'g')))!
    return buildGroupStubs(groupInputFrom(read.form, i.tags ?? [], read.responses), 'g')
  }

  it('round-trips through the server builder', () => {
    const read = responsesFromStubs(stored(buildGroupStubs(input, 'g')))!
    expect(read.form).toMatchObject({ name: 'Est', status: 404, quick: { url: '/est/{office}/{seq}', priority: '3' } })
    expect(read.responses).toMatchObject({ by: input.by, fallbackOn: true, fallbackStubId: 's2' })
    expect(read.responses.rows.map((r) => [r.values, r.form.status, r.form.slow, r.stubId])).toEqual([
      [['1'], 200, false, 's0'],
      [['2'], 201, true, 's1'],
    ])
    expect(roundTrip(input)).toEqual(buildGroupStubs(input, 'g'))
  })

  it('round-trips query, header and JSON body keys, several conditions and values left at any', () => {
    for (const by of [
      [{ location: 'query' as const, expression: 'type' }],
      [{ location: 'header' as const, expression: 'X-Tenant' }],
      [{ location: 'jsonPath' as const, expression: '$.id' }],
    ]) {
      const i = { ...input, request: { method: 'POST' as const, urlType: 'path' as const, url: '/x' }, by }
      expect(roundTrip(i)).toEqual(buildGroupStubs(i, 'g'))
    }
    const two = {
      ...input,
      priority: undefined,
      by: [
        { location: 'path' as const, expression: 'seq' },
        { location: 'header' as const, expression: 'X-Tenant' },
      ],
      responses: [
        { values: ['1', 'acme'], response: { status: 409 } },
        { values: ['1', null], response: { status: 200 } },
        { values: [null, 'acme'], response: { status: 403 } },
      ],
    }
    expect(roundTrip(two)).toEqual(buildGroupStubs(two, 'g'))
    expect(responsesFromStubs(stored(buildGroupStubs(two, 'g')))!.responses.rows.map((r) => r.values)).toEqual([
      ['1', 'acme'],
      ['1', ''],
      ['', 'acme'],
    ])
    // Without "every other request".
    const none = { ...input, fallback: null }
    const read = responsesFromStubs(stored(buildGroupStubs(none, 'g')))!
    expect(read.responses.fallbackOn).toBe(false)
    expect(roundTrip(none)).toEqual(buildGroupStubs(none, 'g'))
  })

  it('anything it cannot show keeps it closed', () => {
    const stubs = stored(buildGroupStubs(input, 'g'))
    expect(responsesFromStubs([{ ...stubs[0]!, response: { ...stubs[0]!.response, transformers: ['response-template'] } }, ...stubs.slice(1)])).toBeNull()
    expect(responsesFromStubs([stubs[0]!, { ...stubs[1]!, request: { ...stubs[1]!.request, method: 'POST' } }])).toBeNull()
    expect(responsesFromStubs([stubs[0]!, { ...stubs[1]!, priority: 9 }])).toBeNull()
  })

  it('checks, the first response, and a response for a near miss', () => {
    const read = responsesFromStubs(stored(buildGroupStubs(input, 'g')))!
    const quick = read.form.quick!
    expect(responsesProblems(quick, read.responses)).toEqual({})
    const twice = { ...read.responses, rows: [...read.responses.rows, { ...read.responses.rows[0]!, key: 'x' }] }
    expect(responsesProblems(quick, twice)).toEqual({ x: 'valueTwice' })
    expect(responsesProblems(quick, { ...read.responses, by: [{ location: 'path', expression: 'nope' }] })).toEqual({ 'by:0': 'byPathMissing' })
    const blank = { ...read.responses, rows: [{ ...read.responses.rows[0]!, values: [' '] }] }
    expect(responsesProblems(quick, blank)).toEqual({ [read.responses.rows[0]!.key]: 'valueRequired' })

    const form = { ...emptyQuickForm(), status: 200, body: '{}' }
    form.quick = { ...form.quick!, urlType: 'template', url: '/u/{id}' }
    const first = addFirstRow(form, noResponses())
    expect(first).toMatchObject({ by: [{ location: 'path', expression: 'id' }], fallbackOn: true, rows: [{ values: [''], form: { status: 200, body: '{}' } }] })
    expect(suggestBy(form.quick, first.by)).toEqual({ location: 'query', expression: '' })

    const added = withValuesRow(read.form, read.responses, ['7'])
    expect(added.rows.map((r) => r.values)).toEqual([['1'], ['2'], ['7']])
    expect(withValuesRow(read.form, read.responses, ['2'])).toBe(read.responses)
    expect(rowLabel([{ location: 'query', expression: 'a' }, { location: 'header', expression: 'H' }], ['1', ''])).toBe('?a = 1')
  })
})

describe('import: stubs that differ by one segment', () => {
  const stub = (extra: Record<string, unknown>, name?: string) => ({ ...(name ? { name } : {}), request: { method: 'GET', ...extra }, response: { status: 200 } }) as unknown as StubMapping
  const mocks = [
    stub({ urlPath: '/q/SequenceNumber/1' }, 'Est'),
    stub({ urlPath: '/other' }),
    stub({ urlPath: '/q/SequenceNumber/2' }, 'Est'),
    stub({ urlPathPattern: '/q/SequenceNumber/.*' }, 'Est'),
    stub({ urlPath: '/q/SequenceNumber/3', queryParameters: { a: { equalTo: '1' } } }),
  ]

  it('finds them, names the variable after the segment before it, and spots the regex fallback', () => {
    expect(findCombinable({ mocks })).toEqual([
      {
        key: 'GET /q/SequenceNumber/{sequenceNumber}',
        method: 'GET',
        template: '/q/SequenceNumber/{sequenceNumber}',
        param: 'sequenceNumber',
        members: [
          { index: 0, value: '1' },
          { index: 2, value: '2' },
        ],
        fallback: 3,
      },
    ])
    expect(findCombinable({ mocks: [mocks[0]!, mocks[1]!] })).toEqual([])
  })

  it('rewrites them into a group the editor can open, unless turned off', () => {
    const [c] = findCombinable({ mocks })
    const out = combineStubs(mocks, c!, new Set())
    const group = [out[0]!, out[2]!, out[3]!].map((s, i) => ({ ...s, id: `x${i}` }))
    expect(group.map((s) => s.request)).toEqual([
      { method: 'GET', urlPathTemplate: '/q/SequenceNumber/{sequenceNumber}', pathParameters: { sequenceNumber: { equalTo: '1' } } },
      { method: 'GET', urlPathTemplate: '/q/SequenceNumber/{sequenceNumber}', pathParameters: { sequenceNumber: { equalTo: '2' } } },
      { method: 'GET', urlPathTemplate: '/q/SequenceNumber/{sequenceNumber}' },
    ])
    expect(group[2]!.priority).toBe(10)
    expect(responsesFromStubs(group)).toMatchObject({ form: { name: 'Est' }, responses: { rows: [{ values: ['1'] }, { values: ['2'] }], fallbackOn: true } })
    expect(out[1]).toBe(mocks[1])

    const bundle = { ...emptyBundle(), mocks }
    const groups = groupForReview(bundle)
    const state = initialReview(groups, [c!])
    expect(reviewedBundle(bundle, groups, state, [c!]).bundle.mocks[0]!.request.urlPathTemplate).toBe('/q/SequenceNumber/{sequenceNumber}')
    expect(reviewedBundle(bundle, groups, { ...state, combine: { [c!.key]: false } }, [c!]).bundle.mocks[0]!.request.urlPath).toBe('/q/SequenceNumber/1')
  })
})
