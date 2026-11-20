import { describe, expect, it } from 'vitest'
import { FAULT_OPTIONS, PRESETS, presetForStatus, presetToStatus, visiblePresets } from '@/ui/lib/presets'

describe('status presets', () => {
  it.each([
    ['success', { status: 200 }],
    ['notFound', { status: 404 }],
    ['validation', { status: 400 }],
    ['serverError', { status: 500 }],
    ['timeout', { status: 504, delayMs: 30_000 }],
  ] as const)('%s → %o', (preset, expected) => {
    expect(presetToStatus(preset)).toEqual(expected)
  })

  it('lists the presets in display order', () => {
    expect(PRESETS).toEqual(['success', 'notFound', 'validation', 'serverError', 'timeout'])
  })

  it('maps a status (and delay) back to its preset', () => {
    expect(presetForStatus(200)).toBe('success')
    expect(presetForStatus(404)).toBe('notFound')
    expect(presetForStatus(400)).toBe('validation')
    expect(presetForStatus(500)).toBe('serverError')
    expect(presetForStatus(504, 30_000)).toBe('timeout')
    expect(presetForStatus(504)).toBe('custom')
    expect(presetForStatus(201)).toBe('custom')
  })

  it('hides presets whose status the endpoint does not allow', () => {
    expect(visiblePresets([])).toEqual(PRESETS)
    expect(visiblePresets([200, 404, 504])).toEqual(['success', 'notFound', 'timeout'])
  })

  it('names the four faults plainly', () => {
    expect(FAULT_OPTIONS.map((f) => f.value)).toEqual([
      'EMPTY_RESPONSE',
      'MALFORMED_RESPONSE_CHUNK',
      'RANDOM_DATA_THEN_CLOSE',
      'CONNECTION_RESET_BY_PEER',
    ])
  })
})
