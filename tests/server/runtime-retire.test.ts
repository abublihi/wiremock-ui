import { describe, expect, it, vi } from 'vitest'
import { retire, type Runtime } from '@/server/runtime'

const fake = () => {
  const stop = vi.fn()
  const close = vi.fn(async () => {})
  return { runtime: { reconciler: { stop }, stores: { close } } as unknown as Runtime, stop, close }
}

describe('retire', () => {
  it('stops the earlier runtime’s reconciler and closes its stores', async () => {
    const { runtime, stop, close } = fake()
    await retire(Promise.resolve(runtime))
    expect(stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('does nothing without an earlier runtime, or when it failed to boot', async () => {
    await expect(retire(undefined)).resolves.toBeUndefined()
    await expect(retire(Promise.reject(new Error('boot failed')))).resolves.toBeUndefined()
  })

  it('handles WireMock-only mode (no reconciler) and a store that fails to close', async () => {
    const close = vi.fn(async () => {
      throw new Error('already closed')
    })
    const runtime = { reconciler: null, stores: { close } } as unknown as Runtime
    await expect(retire(Promise.resolve(runtime))).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('exitOnSignals', () => {
  it('closes the runtime and exits once on SIGTERM', async () => {
    const { exitOnSignals } = await import('@/server/runtime')
    const before = process.listenerCount('SIGTERM')
    const exit = vi.fn()
    exitOnSignals(5_000, exit)
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
    process.emit('SIGTERM', 'SIGTERM')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    process.removeAllListeners('SIGINT')
  })
})
