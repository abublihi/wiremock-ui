import { describe, expect, it } from 'vitest'
import type { StubMapping } from '@/server/wiremock/types'
import { fromEditable, parseStubJson, toEditable, withTags } from '@/ui/lib/editor-sync'

const s = {
  id: 'm-1',
  name: 'Get post',
  request: { method: 'GET', urlPath: '/blog/posts/1' },
  response: { status: 200, jsonBody: { id: 1 } },
  metadata: { wiremockUi: { owner: 'sara', version: 2, updatedAt: '2026-11-19T00:00:00.000Z', updatedBy: 'sara', source: 'ui', tags: ['blog'] } },
} as unknown as StubMapping

describe('Advanced JSON helpers', () => {
  it('toEditable drops the id and the server metadata, keeping everything else', () => {
    const withExtra = { ...s, uuid: 'u-1', persistent: false, metadata: { ...s.metadata, team: 'x' } } as StubMapping
    const editable = toEditable(withExtra)
    expect(editable).not.toHaveProperty('id')
    expect(editable).not.toHaveProperty('uuid')
    expect(editable).not.toHaveProperty('persistent')
    expect(editable.metadata).toEqual({ team: 'x' })
    expect(editable.request).toEqual(s.request)
    expect(toEditable(s)).not.toHaveProperty('metadata')
  })

  it('fromEditable never sends the UI metadata typed in the JSON; withTags puts the tags back', () => {
    const editable = { ...toEditable(s), metadata: { wiremockUi: { owner: 'mallory', version: 99 }, team: 'x' } }
    expect(fromEditable(editable, undefined).metadata).toEqual({ team: 'x' })
    expect(withTags(fromEditable(editable, undefined), ['blog', 'v2']).metadata).toEqual({ team: 'x', wiremockUi: { tags: ['blog', 'v2'] } })
    expect(withTags(fromEditable(toEditable(s), undefined), [])).not.toHaveProperty('metadata')
  })

  it('parseStubJson reports the line and column of a syntax error', () => {
    expect(parseStubJson('{"request": {}, "response": {}}')).toEqual({ ok: true, value: { request: {}, response: {} } })
    const bad = parseStubJson('{\n  "request": {},\n  "response": {\n}')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.line).toBe(4)
      expect(bad.column).toBeGreaterThan(0)
      expect(bad.message).not.toMatch(/line \d+|position \d+/)
    }
    const trailing = parseStubJson('{\n  "a": 1,\n}')
    expect(trailing.ok || trailing.line).toBe(3)
  })

  it('parseStubJson gives no position when the engine names none (other than the end)', () => {
    const end = parseStubJson('{\n  "a": ')
    expect(end).toMatchObject({ ok: false, line: 2, column: 8 })
    const odd = parseStubJson('{"a": tru}')
    expect(odd.ok).toBe(false)
  })

  it('parseStubJson wants an object', () => {
    expect(parseStubJson('[]')).toMatchObject({ ok: false, reason: 'notObject' })
    expect(parseStubJson('')).toMatchObject({ ok: false, reason: 'syntax' })
  })
})

describe('isScenarioNameSettable (kept in step with the server)', () => {
  it('matches the server rule', async () => {
    const { isScenarioNameSettable: server } = await import('@/server/wiremock/client')
    const { isScenarioNameSettable: ui } = await import('@/ui/lib/editor-sync')
    for (const name of ['loan', 'loan-approval_2.x', 'with space', '.hidden', 'a/b', 'a%20b', 'ok:@!', '']) expect(ui(name)).toBe(server(name))
  })
})
