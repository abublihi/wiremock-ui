import { AppError, ValidationError } from '../../errors'
import { importBundle } from '../../bundle/importer'
import { parseBundle } from '../../bundle/parse'
import { legacyEndpoints } from '../../catalog/migrate-store'
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
  const query = new URL(request.url).searchParams
  const prune = query.get('prune') === 'true'
  // The import review asks first: the same checks and outcomes, nothing written.
  const dryRun = query.get('dryRun') === 'true'
  // Spec A10: never delete stubs from the user's own WireMock.
  if (prune && rt.config.storeDriver === 'none') throw new ValidationError('Prune is not available in WireMock-only mode')
  const report = await importBundle(bundle, {
    legacyEndpoints: () => legacyEndpoints(rt.stores.catalog),
    mocks: rt.mocks,
    store: rt.store,
    audit: rt.audit,
    reposition: rt.reconciler ? () => rt.reconciler!.repositionPersonMocks() : undefined,
  }, {
    actor: principal.user.username,
    prune,
    source: 'import',
    dryRun,
  })
  return json(report)
})
