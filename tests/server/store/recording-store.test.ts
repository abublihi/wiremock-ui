import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { MemoryRecordingStore } from '../../../src/server/recording/store'
import type { Recording, RecordingStore } from '../../../src/server/recording/types'
import { drivers, type StoreHarness } from '../../helpers/stores'

const rec = (id: string, createdAt: string, expiresInMs: number): Recording => ({
  id,
  kind: 'recording',
  target: 'https://api.example.com',
  createdAt,
  createdBy: 'ann',
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  items: [
    {
      id: `${id}-1`,
      stub: { request: { method: 'GET', urlPath: '/a' }, response: { status: 200, body: 'x' } },
      method: 'GET',
      url: '/a',
      status: 200,
      bodySize: 1,
    },
  ],
  dropped: 0,
})

const contract = (start: () => Promise<{ store: RecordingStore; stop(): Promise<void>; reset(): Promise<void> }>) => {
  let h: Awaited<ReturnType<typeof start>>
  beforeAll(async () => {
    h = await start()
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(async () => {
    await h.reset()
  })

  test('put, get, list newest first, delete', async () => {
    await h.store.put(rec('a', '2026-11-20T10:00:00.000Z', 60_000))
    await h.store.put(rec('b', '2026-11-20T11:00:00.000Z', 60_000))
    expect(await h.store.get('a')).toMatchObject({ id: 'a', kind: 'recording', createdBy: 'ann', target: 'https://api.example.com', dropped: 0 })
    expect((await h.store.get('a'))?.items[0].stub).toEqual({ request: { method: 'GET', urlPath: '/a' }, response: { status: 200, body: 'x' } })
    expect((await h.store.list()).map((r) => r.id)).toEqual(['b', 'a'])
    await h.store.delete('a')
    expect(await h.store.get('a')).toBeNull()
    expect((await h.store.list()).map((r) => r.id)).toEqual(['b'])
    await h.store.delete('missing')
  })

  test('put replaces a list and keeps its expiry; an expired list reads as missing', async () => {
    const a = rec('a', '2026-11-20T10:00:00.000Z', 60_000)
    await h.store.put(a)
    await h.store.put({ ...a, items: [] })
    expect((await h.store.get('a'))?.items).toEqual([])
    expect((await h.store.get('a'))?.expiresAt).toBe(a.expiresAt)
    await h.store.put(rec('old', '2026-11-20T09:00:00.000Z', 300))
    expect(await h.store.get('old')).not.toBeNull()
    await new Promise((r) => setTimeout(r, 400))
    expect(await h.store.get('old')).toBeNull()
    expect((await h.store.list()).map((r) => r.id)).toEqual(['a'])
  })
}

const contractActive = (start: () => Promise<{ store: RecordingStore; stop(): Promise<void>; reset(): Promise<void> }>) => {
  let h: Awaited<ReturnType<typeof start>>
  beforeAll(async () => {
    h = await start()
  })
  afterAll(async () => {
    await h?.stop()
  })
  beforeEach(async () => {
    await h.reset()
  })
  test('the active recording: none, set, replaced, cleared', async () => {
    expect(await h.store.getActive()).toBeNull()
    const a = { target: 'https://a.example', startedBy: 'ann', startedAt: '2026-11-20T10:00:00.000Z' }
    await h.store.setActive(a)
    expect(await h.store.getActive()).toEqual(a)
    await h.store.setActive({ ...a, startedBy: 'bob' })
    expect((await h.store.getActive())?.startedBy).toBe('bob')
    await h.store.setActive(null)
    expect(await h.store.getActive()).toBeNull()
  })
}

describe.each(drivers)('RecordingStore active record on %s', (_driver, startDriver) => {
  contractActive(async () => {
    const harness: StoreHarness = await startDriver()
    return { store: harness.stores.recordings, stop: () => harness.stop(), reset: () => harness.probe.reset() }
  })
})

describe('SQLite purges expired review lists when it opens', () => {
  test('an expired row is gone from the table after reopening', async () => {
    const h = (await drivers.find(([d]) => d === 'sqlite')![1]()) as StoreHarness
    try {
      await h.stores.recordings.put(rec('soon', '2026-11-20T09:00:00.000Z', 200))
      await new Promise((r) => setTimeout(r, 300))
      const reopened = h.reopen!()
      // Read the raw table through a fresh list-free path: count rows directly.
      expect(await h.probe.isEmpty()).toBe(true)
      expect(await reopened.recordings.getActive()).toBeNull()
    } finally {
      await h.stop()
    }
  })
})

describe.each(drivers)('RecordingStore on %s', (_driver, startDriver) => {
  contract(async () => {
    const harness: StoreHarness = await startDriver()
    return { store: harness.stores.recordings, stop: () => harness.stop(), reset: () => harness.probe.reset() }
  })
})

describe('RecordingStore in memory', () => {
  let store = new MemoryRecordingStore()
  contract(async () => ({
    get store() {
      return store
    },
    stop: async () => {},
    reset: async () => {
      store = new MemoryRecordingStore()
    },
  }))
})
