import type { LoggedEvent } from '@/server/wiremock/types'

export type RequestPrefill = {
  request: { method: string; urlPath: string; bodyPatterns?: { equalToJson: string; ignoreExtraElements: true }[] }
  response: { status: number }
}

/** A JSON object or array, parsed; anything else (form data, text, scalars) is null. */
export function parseJsonBody(body: string | undefined): object | null {
  if (!body?.trim()) return null
  try {
    const value: unknown = JSON.parse(body)
    return typeof value === 'object' && value !== null ? value : null
  } catch {
    return null
  }
}

/**
 * The starting stub for "Create mock from this request": its method and path (and JSON body, extra fields allowed),
 * answering 200 — the shape the quick form shows.
 */
export function stubFromRequest(event: Pick<LoggedEvent, 'request'>): RequestPrefill {
  const { method, url, body } = event.request
  const json = parseJsonBody(body)
  return {
    request: {
      method: method || 'GET',
      urlPath: url.split('?')[0] || '/',
      ...(json ? { bodyPatterns: [{ equalToJson: JSON.stringify(json, null, 2), ignoreExtraElements: true as const }] } : {}),
    },
    response: { status: 200 },
  }
}
