import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AuditLog } from '../../../src/server/audit/log'
import { drivers, type StoreHarness } from '../../helpers/stores'

describe.each(drivers)('AuditLog on %s', (_driver, start) => {
  let h: StoreHarness
  let log: AuditLog

  beforeAll(async () => {
    h = await start()
    log = h.stores.audit
  })
  afterAll(async () => {
    vi.useRealTimers()
    await h?.stop()
  })
  beforeEach(async () => {
    vi.useRealTimers()
    await h.probe.reset()
  })

  test('audit list newest first, respects limit and cursor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    for (const [i, action] of ['a', 'b', 'c'].entries()) {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 1, 0, 0, i)))
      await log.record({ actor: 'sara', action, target: 't', details: { n: i } })
    }
    vi.useRealTimers()
    const all = await log.list()
    expect(all.entries.map((e) => e.action)).toEqual(['c', 'b', 'a'])
    expect(all.nextCursor).toBeNull()
    expect(all.entries[0]).toMatchObject({ actor: 'sara', target: 't', details: { n: 2 }, at: '2026-11-01T00:00:02.000Z' })
    const first = await log.list({ limit: 2 })
    expect(first.entries.map((e) => e.action)).toEqual(['c', 'b'])
    expect(typeof first.nextCursor).toBe('string')
    const rest = await log.list({ limit: 2, cursor: first.nextCursor! })
    expect(rest).toEqual({ entries: [expect.objectContaining({ action: 'a' })], nextCursor: null })
  })

  test('audit drops entries older than 30 days on write', async () => {
    const old = Date.now() - 31 * 86_400_000
    await h.probe.addAuditAt(old, { at: new Date(old).toISOString(), actor: 'x', action: 'old' })
    await log.record({ actor: 'sara', action: 'new' })
    expect((await log.list()).entries.map((e) => e.action)).toEqual(['new'])
    expect(await h.probe.auditCount()).toBe(1)
  })

  test('entries with identical content are kept separately', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'))
    await log.record({ actor: 'sara', action: 'same' })
    await log.record({ actor: 'sara', action: 'same' })
    expect((await log.list()).entries).toHaveLength(2)
  })

  test('entries written in the same millisecond list exactly newest-first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 1)))
    for (let i = 0; i < 20; i++) await log.record({ actor: 'sara', action: `a${i}` })
    vi.useRealTimers()
    const actions = (await log.list()).entries.map((e) => e.action)
    expect(actions).toEqual(Array.from({ length: 20 }, (_, i) => `a${19 - i}`))
  })

  test('30 entries in the same millisecond, paged 7 at a time, come back exactly once each, in order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 2)))
    for (let i = 0; i < 30; i++) await log.record({ actor: 'sara', action: `a${i}` })
    vi.useRealTimers()
    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const res = await log.list({ limit: 7, cursor })
      seen.push(...res.entries.map((e) => e.action))
      if (!res.nextCursor) break
      cursor = res.nextCursor
    }
    expect(seen).toEqual(Array.from({ length: 30 }, (_, i) => `a${29 - i}`))
  })

  test('paging across different milliseconds and entries written after the first page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 3, 0, 0, 0, Math.floor(i / 2))))
      await log.record({ actor: 'sara', action: `b${i}` })
    }
    const first = await log.list({ limit: 3 })
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 3, 0, 0, 1)))
    await log.record({ actor: 'sara', action: 'late' })
    vi.useRealTimers()
    const second = await log.list({ limit: 3, cursor: first.nextCursor! })
    expect([...first.entries, ...second.entries].map((e) => e.action)).toEqual(['b5', 'b4', 'b3', 'b2', 'b1', 'b0'])
    expect(second.nextCursor).toBeNull()
  })

  test('the cursor has the same opaque (score, sequence) shape on every driver', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 4)))
    await log.record({ actor: 'sara', action: 'x' })
    await log.record({ actor: 'sara', action: 'y' })
    vi.useRealTimers()
    const { nextCursor } = await log.list({ limit: 1 })
    expect(Buffer.from(nextCursor!, 'base64url').toString('utf8')).toMatch(new RegExp(`^${Date.UTC(2026, 10, 4)}:\\d{16}$`))
  })

  test('a malformed cursor is a ValidationError', async () => {
    await expect(log.list({ cursor: 'nope' })).rejects.toMatchObject({ status: 400, message: 'cursor is invalid' })
  })
})
