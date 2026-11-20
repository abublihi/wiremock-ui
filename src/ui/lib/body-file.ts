import type { MessageKey } from '@/ui/i18n'

/** "Upload body from file": larger bodies belong in WireMock's own __files folder, which this UI does not manage. */
export const MAX_BODY_FILE_BYTES = 5 * 1024 * 1024
export const BINARY_MIME = 'application/octet-stream'

const TEXT_TYPES: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
}
const OTHER_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
}

const extension = (name: string) => (/\.([^./\\]+)$/.exec(name)?.[1] ?? '').toLowerCase()

type FileLike = { name: string; type: string }

/** Text-like (json, xml, txt, html, csv, or a text/* type): stored as text; anything else as base64. */
export function isTextLike(file: FileLike): boolean {
  return extension(file.name) in TEXT_TYPES || file.type.startsWith('text/')
}

/** The file's own type, else one from its extension, else application/octet-stream. */
export function contentTypeFor(file: FileLike): string {
  if (file.type) return file.type
  const ext = extension(file.name)
  return TEXT_TYPES[ext] ?? OTHER_TYPES[ext] ?? BINARY_MIME
}

export type BodyFile =
  | { kind: 'text'; text: string; name: string; size: number; contentType: string }
  | { kind: 'binary'; base64: string; name: string; size: number; contentType: string }

export class BodyFileError extends Error {
  readonly key: MessageKey
  readonly params: Record<string, string | number>
  constructor(key: MessageKey, params: Record<string, string | number>) {
    super(key)
    this.name = 'BodyFileError'
    this.key = key
    this.params = params
  }
}

/** Standard base64 (with padding) of any bytes, encoded in chunks so large files do not overflow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

/** How many bytes a base64 string decodes to. */
export function base64Size(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export async function readBodyFile(file: File): Promise<BodyFile> {
  if (file.size > MAX_BODY_FILE_BYTES) {
    throw new BodyFileError('editor.bodyFile.tooLarge', { name: file.name, size: formatSize(file.size) })
  }
  const contentType = contentTypeFor(file)
  try {
    if (isTextLike(file)) return { kind: 'text', text: await file.text(), name: file.name, size: file.size, contentType }
    const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    return { kind: 'binary', base64, name: file.name, size: file.size, contentType }
  } catch {
    throw new BodyFileError('editor.bodyFile.readFailed', { name: file.name })
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isJsonType = (type: string) => /[/+]json\b/i.test(type)

/**
 * Puts a file into a stub as its response body (Advanced mode): a binary file as base64Body; a text file as
 * jsonBody when it is valid JSON of a JSON type (the file's, or `opts.json` for an endpoint of type json), else
 * as body. Other body fields are removed. The Content-Type is set from the file unless the stub already has one.
 */
export function applyBodyFile(stub: Record<string, unknown>, file: BodyFile, opts: { json?: boolean } = {}): Record<string, unknown> {
  const { body: _b, jsonBody: _j, base64Body: _64, bodyFileName: _f, ...response } = isRecord(stub.response) ? stub.response : {}
  const headers = isRecord(response.headers) ? { ...response.headers } : {}
  const hasType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')
  if (file.kind === 'binary') response.base64Body = file.base64
  else {
    let parsed: { value: unknown } | null = null
    if (opts.json || isJsonType(file.contentType)) {
      try {
        parsed = { value: JSON.parse(file.text) }
      } catch {
        parsed = null
      }
    }
    if (parsed) response.jsonBody = parsed.value
    else response.body = file.text
  }
  response.headers = hasType ? headers : { ...headers, 'Content-Type': file.contentType }
  return { ...stub, response }
}
