import { AppError, ValidationError } from '../../errors'
import { importBundle } from '../../bundle/importer'
import { parseBundle } from '../../bundle/parse'
import { json, requireJson, withAuth } from '../wrap'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024

class PayloadTooLargeError extends AppError {
  constructor() {
    super('Import body must be at most 10 MB', 413)
  }
}

export const runImport = withAuth('import.run', async ({ rt, request, principal }) => {
  requireJson(request)
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES) throw new PayloadTooLargeError()
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) throw new PayloadTooLargeError()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
  const bundle = parseBundle(body, 'request body')
  const prune = new URL(request.url).searchParams.get('prune') === 'true'
  // Spec A10: never delete stubs from the user's own WireMock.
  if (prune && rt.config.storeDriver === 'none') throw new ValidationError('Prune is not available in WireMock-only mode')
  const report = await importBundle(bundle, {
    catalog: rt.catalog,
    mocks: rt.mocks,
    store: rt.store,
    audit: rt.audit,
    reposition: rt.reconciler ? () => rt.reconciler!.repositionPersonMocks() : undefined,
  }, {
    actor: principal.user.username,
    prune,
    source: 'import',
  })
  return json(report)
})
