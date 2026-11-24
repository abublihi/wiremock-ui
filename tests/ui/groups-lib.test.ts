import { describe, expect, it } from 'vitest'
import { emptyBundle } from '@/server/bundle/shape'
import { buildGroupStubs } from '@/server/mocks/groups'
import type { StubMapping } from '@/server/wiremock/types'
import { emptyQuickForm } from '@/ui/lib/editor-sync'
import { answerFor, groupFormFromSimple, groupFormFromStubs, groupInput, groupProblems } from '@/ui/lib/groups'
import { combineStubs, findCombinable, groupForReview, initialReview, reviewedBundle } from '@/ui/lib/import-review'

const stored = (stubs: ReturnType<typeof buildGroupStubs>) => stubs.map((s, i) => ({ id: `s${i}`, ...s }) as unknown as StubMapping)

describe('the several-responses form', () => {
  const input = {
    name: 'Est',
    tags: ['qiwa'],
    priority: 3,
    request: { method: 'GET' as const, urlType: 'template' as const, url: '/est/{office}/{seq}', query: { lang: 'en' } },
    by: { location: 'path' as const, expression: 'seq' },
    responses: [
      { value: '1', response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{\n  "ok": true\n}' } },
      { value: '2', response: { status: 201, body: 'plain', delayMs: 300 } },
    ],
    fallback: { response: { status: 404 } },
  }

  it('round-trips through the server builder', () => {
    const form = groupFormFromStubs(stored(buildGroupStubs(input, 'g')))!
    expect(form).toMatchObject({ name: 'Est', tags: ['qiwa'], by: input.by, quick: { url: '/est/{office}/{seq}', priority: '3' }, fallback: { on: true } })
    expect(form.rows.map((r) => [r.value, r.response.status, r.response.delayMs])).toEqual([
      ['1', '200', ''],
      ['2', '201', '300'],
    ])
    expect(buildGroupStubs(groupInput(form), 'g')).toEqual(buildGroupStubs(input, 'g'))
  })

  it('round-trips query, header and JSON body keys', () => {
    for (const by of [
      { location: 'query' as const, expression: 'type' },
      { location: 'header' as const, expression: 'X-Tenant' },
      { location: 'jsonPath' as const, expression: '$.id' },
    ]) {
      const i = { ...input, request: { method: 'POST' as const, urlType: 'path' as const, url: '/x' }, by }
      expect(buildGroupStubs(groupInput(groupFormFromStubs(stored(buildGroupStubs(i, 'g')))!), 'g')).toEqual(buildGroupStubs(i, 'g'))
    }
  })

  it('anything it cannot show keeps it closed', () => {
    const stubs = stored(buildGroupStubs(input, 'g'))
    expect(groupFormFromStubs([{ ...stubs[0]!, response: { ...stubs[0]!.response, transformers: ['response-template'] } }, ...stubs.slice(1)])).toBeNull()
    expect(groupFormFromStubs([stubs[0]!, { ...stubs[1]!, request: { ...stubs[1]!.request, method: 'POST' } }])).toBeNull()
  })

  it('checks, Try it and growing from a URL mock', () => {
    const form = groupFormFromStubs(stored(buildGroupStubs(input, 'g')))!
    expect(groupProblems(form)).toEqual({})
    expect(groupProblems({ ...form, rows: [...form.rows, { ...form.rows[0]!, key: 'x' }] })).toEqual({ x: 'valueTwice' })
    expect(groupProblems({ ...form, by: { location: 'path', expression: 'nope' } })).toEqual({ by: 'byPathMissing' })
    expect(answerFor(form, '2')).toMatchObject({ kind: 'row', row: { value: '2' } })
    expect(answerFor(form, '9').kind).toBe('fallback')
    expect(answerFor({ ...form, fallback: { ...form.fallback, on: false } }, '9').kind).toBe('none')

    const quick = { ...emptyQuickForm(), status: 200, body: '{}' }
    quick.quick = { ...quick.quick!, urlType: 'template', url: '/u/{id}' }
    expect(groupFormFromSimple(quick, ['t'])).toMatchObject({ tags: ['t'], by: { location: 'path', expression: 'id' }, rows: [{ value: '', response: { status: '200', body: '{}' } }] })
    expect(groupFormFromSimple({ ...quick, fault: 'EMPTY_RESPONSE' }, [])).toBeNull()
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
    expect(groupFormFromStubs(group)).toMatchObject({ name: 'Est', rows: [{ value: '1' }, { value: '2' }], fallback: { on: true } })
    expect(out[1]).toBe(mocks[1])

    const bundle = { ...emptyBundle(), mocks }
    const groups = groupForReview(bundle)
    const state = initialReview(groups, [c!])
    expect(reviewedBundle(bundle, groups, state, [c!]).bundle.mocks[0]!.request.urlPathTemplate).toBe('/q/SequenceNumber/{sequenceNumber}')
    expect(reviewedBundle(bundle, groups, { ...state, combine: { [c!.key]: false } }, [c!]).bundle.mocks[0]!.request.urlPath).toBe('/q/SequenceNumber/1')
  })
})
