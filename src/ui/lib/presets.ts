import type { SimpleMockInput } from '@/server/catalog/build'
import type { MessageKey } from '@/ui/i18n'

export type Fault = NonNullable<SimpleMockInput['fault']>
export type PresetName = 'success' | 'notFound' | 'validation' | 'serverError' | 'timeout'
export type Preset = PresetName | 'custom'

/** The Simple-mode status presets, in display order (exact values from the plan's Global Constraints). */
export const PRESETS: readonly PresetName[] = ['success', 'notFound', 'validation', 'serverError', 'timeout']

const VALUES: Record<PresetName, { status: number; delayMs?: number }> = {
  success: { status: 200 },
  notFound: { status: 404 },
  validation: { status: 400 },
  serverError: { status: 500 },
  timeout: { status: 504, delayMs: 30_000 },
}

export const TIMEOUT_DELAY_MS = 30_000
export const SLOW_MIN_SECONDS = 1
export const SLOW_MAX_SECONDS = 120

export const PRESET_LABEL: Record<Preset, MessageKey> = {
  success: 'editor.preset.success',
  notFound: 'editor.preset.notFound',
  validation: 'editor.preset.validation',
  serverError: 'editor.preset.serverError',
  timeout: 'editor.preset.timeout',
  custom: 'editor.preset.custom',
}

export function presetToStatus(preset: PresetName): { status: number; delayMs?: number } {
  return { ...VALUES[preset] }
}

/** The preset a status (and delay) belongs to; anything else is "custom". */
export function presetForStatus(status: number, delayMs?: number): Preset {
  if (status === 504) return delayMs === TIMEOUT_DELAY_MS ? 'timeout' : 'custom'
  return PRESETS.find((p) => p !== 'timeout' && VALUES[p].status === status) ?? 'custom'
}

/** Presets the endpoint allows (an empty allow-list allows every status). */
export function visiblePresets(allowedStatuses: number[]): PresetName[] {
  if (allowedStatuses.length === 0) return [...PRESETS]
  return PRESETS.filter((p) => allowedStatuses.includes(VALUES[p].status))
}

export const FAULT_OPTIONS: readonly { value: Fault; label: MessageKey }[] = [
  { value: 'EMPTY_RESPONSE', label: 'editor.fault.empty' },
  { value: 'MALFORMED_RESPONSE_CHUNK', label: 'editor.fault.garbled' },
  { value: 'RANDOM_DATA_THEN_CLOSE', label: 'editor.fault.random' },
  { value: 'CONNECTION_RESET_BY_PEER', label: 'editor.fault.reset' },
]

export const isFault = (value: unknown): value is Fault => FAULT_OPTIONS.some((f) => f.value === value)

/** The methods the webhook form offers (the server accepts any method token; others stay in Advanced mode). */
export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number]
export const isWebhookMethod = (value: unknown): value is WebhookMethod => WEBHOOK_METHODS.includes(value as WebhookMethod)

/** The webhook delay cap (src/server/mocks/power-fields.ts). */
export const MAX_WEBHOOK_DELAY_MS = 600_000
