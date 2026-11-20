import { z } from 'zod'
import { assertCsrf, authenticate, type Principal } from '../auth/authenticate'
import { can, type Permission } from '../auth/permissions'
import { AppError, ValidationError } from '../errors'
import { logger } from '../logger'
import type { Runtime } from '../runtime'

export type Params = { id?: string; key?: string; endpoint?: string; name?: string }
export type Handler = (rt: Runtime, request: Request, params?: Params) => Promise<Response>
export type AuthContext = { rt: Runtime; request: Request; params: Params; principal: Principal }

export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

export function withErrors(handler: Handler): Handler {
  return async (rt, request, params) => {
    try {
      return await handler(rt, request, params)
    } catch (err) {
      if (err instanceof ValidationError && err.field) return json({ error: err.message, field: err.field }, err.status)
      if (err instanceof AppError) return json({ error: err.message }, err.status)
      logger.error({ err, url: request.url }, 'unhandled error')
      return json({ error: 'Internal error' }, 500)
    }
  }
}

/** authenticate → CSRF (session + unsafe method) → permission → handler. `null` = any signed-in user. */
export function withAuth(permission: Permission | null, handler: (ctx: AuthContext) => Promise<Response>): Handler {
  return withErrors(async (rt, request, params) => {
    const principal = await authenticate(request, { users: rt.stores.users, config: rt.config })
    assertCsrf(request, principal)
    if (permission && !can(permission)) throw new AppError('Forbidden', 403)
    return handler({ rt, request, params: params ?? {}, principal })
  })
}

export function parse<T>(schema: z.ZodType<T>, data: unknown, prefix = ''): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = [...issue.path].map(String)
  // Zod reports a missing field with a generic message; name the field explicitly.
  const named = issue.message.includes(path[path.length - 1] ?? '\0') || path.length === 0 ? issue.message : `${path.join('.')}: ${issue.message}`
  throw new ValidationError(`${prefix}${named}`, path.length > 0 ? path.join('.') : undefined)
}

class UnsupportedMediaTypeError extends AppError {
  constructor() {
    super('Content-Type must be application/json', 415)
  }
}

// Cross-site text/plain POSTs need no CORS preflight, so refuse anything but JSON.
export function requireJson(request: Request): void {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') throw new UnsupportedMediaTypeError()
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
}

/**
 * Reads the request body as JSON, stopping at `limit` bytes whether or not a Content-Length was sent (chunked).
 * Over the limit → 413 with `tooLarge`; a body that breaks off (client gone, bad chunking) → 400.
 */
export async function readJsonCapped(request: Request, limit: number, tooLarge: string): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new AppError(tooLarge, 413)
  const chunks: Uint8Array[] = []
  let size = 0
  if (request.body) {
    const reader = request.body.getReader()
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch {
        throw new ValidationError('The request body could not be read (the connection broke off). Send it again.')
      }
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw new AppError(tooLarge, 413)
      }
      chunks.push(chunk.value)
    }
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
}

export const idOf = (params?: Params) => {
  if (!params?.id) throw new ValidationError('id is required')
  return params.id
}
