import { expect, test } from 'vitest'
import { RecordingService, TOO_LARGE } from '../../../src/server/recording/service'
import { MemoryRecordingStore } from '../../../src/server/recording/store'
import type { StubMapping } from '../../../src/server/wiremock/types'

// The service against fakes: what WireMock's admin API and the store see, in which order.

const stub = (n: number, body = 'x'): StubMapping => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  request: { method: 'GET', url: `/p/${n}` },
  response: { status: 200, body },
})

function setup(opts: { stubs: StubMapping[]; failDeletes?: Set<string>; failTwice?: boolean }) {
  const events: string[] = []
  const store = new MemoryRecordingStore()
  const put = store.put.bind(store)
  store.put = async (r) => {
    events.push(`put:${r.items.length}`)
    return put(r)
  }
  let inFlight = 0
  let maxInFlight = 0
  const attempts = new Map<string, number>()
  const wiremock = {
    recordingStatus: async () => 'Recording' as const,
    listStubs: async () => [],
    stopRecording: async () => opts.stubs,
    snapshotRecording: async () => opts.stubs,
    deleteStub: async (id: string) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      events.push(`delete:${id.slice(-2)}`)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      const n = (attempts.get(id) ?? 0) + 1
      attempts.set(id, n)
      if (opts.failDeletes?.has(id) && (opts.failTwice || n === 1)) throw new Error('boom')
    },
  }
  const held = new Set<string>()
  const locks = {
    acquireLock: async (name: string) => (held.has(name) ? null : (held.add(name), name)),
    releaseLock: async (name: string) => void held.delete(name),
  }
  let created = 0
  const mocks = {
    list: async () => [],
    createRecorded: async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { id: `m${++created}` }
    },
  }
  const svc = new RecordingService({
    wiremock: wiremock as never,
    store,
    locks,
    mocks: mocks as never,
    catalog: {} as never,
    audit: { record: async () => {}, list: async () => ({ entries: [], nextCursor: null }) },
    config: { recordingAllowed: true, wiremockUrl: 'http://wiremock:8080', wiremockPublicUrl: 'http://wiremock:8080' },
  })
  return { svc, store, events, attempts, maxInFlight: () => maxInFlight, held, created: () => created }
}

test('the review list is saved before the stubs leave WireMock; deletes go in batches of 20', async () => {
  const stubs = Array.from({ length: 45 }, (_, i) => stub(i + 1))
  const h = setup({ stubs })
  const rec = await h.svc.snapshot({}, 'ann')
  expect(h.events[0]).toBe('put:45')
  expect(h.events.filter((e) => e.startsWith('delete')).length).toBe(45)
  expect(h.maxInFlight()).toBeLessThanOrEqual(20)
  expect(rec?.leftInWireMock).toBeUndefined()
})

test('a failed delete is retried once; what still fails is counted in leftInWireMock', async () => {
  const stubs = [stub(1), stub(2), stub(3)]
  const once = setup({ stubs, failDeletes: new Set([stubs[1].id]) })
  expect((await once.svc.stop('ann'))?.leftInWireMock).toBeUndefined()
  expect(once.attempts.get(stubs[1].id)).toBe(2)

  const twice = setup({ stubs, failDeletes: new Set([stubs[1].id, stubs[2].id]), failTwice: true })
  const rec = await twice.svc.stop('ann')
  expect(rec?.leftInWireMock).toBe(2)
  expect((await twice.store.get(rec!.id))?.leftInWireMock).toBe(2)
})

test('a body over 1 MB is not kept: the row is flagged and cannot be accepted; the list caps at 20 MB', async () => {
  const big = 'a'.repeat(1024 * 1024 + 1)
  const h = setup({ stubs: [stub(1), stub(2, big)] })
  const rec = (await h.svc.snapshot({}, 'ann'))!
  const large = rec.items.find((i) => i.url === '/p/2')!
  expect(large).toMatchObject({ tooLarge: true, bodySize: 1024 * 1024 + 1 })
  expect(large.stub.response).toEqual({ status: 200 })
  const res = await h.svc.accept(rec.id, { items: [{ id: large.id }] }, { username: 'ann' } as never)
  expect(res.failed).toEqual([{ id: large.id, error: TOO_LARGE }])
  expect(res.recording?.items).toHaveLength(2)

  // 25 bodies of 900 KB: about 22 MB, so the last rows are dropped.
  const many = setup({ stubs: Array.from({ length: 25 }, (_, i) => stub(i + 1, 'b'.repeat(900 * 1024))) })
  const capped = (await many.svc.snapshot({}, 'ann'))!
  expect(capped.items.length).toBeLessThan(25)
  expect(capped.items.length + capped.dropped).toBe(25)
  expect(Buffer.byteLength(JSON.stringify(capped.items))).toBeLessThanOrEqual(20 * 1024 * 1024)
})

test('list returns summaries without rows', async () => {
  const h = setup({ stubs: [stub(1), stub(2)] })
  const rec = (await h.svc.snapshot({}, 'ann'))!
  const [summary] = await h.svc.list()
  expect(summary).toEqual({ id: rec.id, kind: 'snapshot', createdAt: rec.createdAt, createdBy: 'ann', expiresAt: rec.expiresAt, dropped: 0, itemCount: 2 })
})

test('accept and discard hold the list lock: a second one at the same time is a 409, nothing is created twice', async () => {
  const h = setup({ stubs: [stub(1), stub(2)] })
  const rec = (await h.svc.snapshot({}, 'ann'))!
  const items = { items: rec.items.map((i) => ({ id: i.id })) }
  const [a, b] = await Promise.allSettled([
    h.svc.accept(rec.id, items, { username: 'ann' } as never),
    h.svc.accept(rec.id, items, { username: 'bob' } as never),
  ])
  expect(a.status).toBe('fulfilled')
  expect(b).toMatchObject({ status: 'rejected', reason: { status: 409 } })
  expect(h.created()).toBe(2)
  expect(h.held.size).toBe(0)
  // The list is gone once every row was accepted: a discard after that finds nothing.
  await expect(h.svc.discard(rec.id, undefined, 'ann')).rejects.toMatchObject({ status: 404 })
})

test('the active recording comes from the store, so another instance knows who started it', async () => {
  const h = setup({ stubs: [] })
  await h.store.setActive({ target: 'https://api.example.com', startedBy: 'ann', startedAt: '2026-11-20T10:00:00.000Z' })
  expect(await h.svc.state()).toEqual({ status: 'recording', target: 'https://api.example.com', startedBy: 'ann', startedAt: '2026-11-20T10:00:00.000Z' })
  expect(await h.svc.stop('ann')).toBeNull()
  expect(await h.store.getActive()).toBeNull()
})

test('in one process the list is guarded even when the store grants every lock (WireMock-only mode)', async () => {
  const h = setup({ stubs: [stub(1)] })
  const rec = (await h.svc.snapshot({}, 'ann'))!
  // Replace the store lock with one that always grants, like WireMockMockStore.
  ;(h.svc as unknown as { deps: { locks: unknown } }).deps.locks = { acquireLock: async () => 't', releaseLock: async () => {} }
  const items = { items: [{ id: rec.items[0].id }] }
  const [a, b] = await Promise.allSettled([h.svc.accept(rec.id, items, { username: 'ann' } as never), h.svc.accept(rec.id, items, { username: 'bob' } as never)])
  expect(a.status).toBe('fulfilled')
  expect(b).toMatchObject({ status: 'rejected', reason: { status: 409 } })
  expect(h.created()).toBe(1)
})
