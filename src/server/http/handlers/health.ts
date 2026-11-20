import { json, withErrors } from '../wrap'

/** Resolves false when the check fails or takes longer than 2 s (the image HEALTHCHECK allows 3 s). */
function bounded(check: Promise<boolean>): Promise<boolean> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), 2000)
    timer.unref()
  })
  return Promise.race([check, timeout])
    .catch(() => false)
    .finally(() => clearTimeout(timer))
}

export const healthz = withErrors(async (rt) => {
  const [store, wiremock] = await Promise.all([bounded(rt.store.ping()), bounded(rt.wiremock.ping())])
  const body = {
    ui: 'ok',
    store: store ? 'ok' : 'error',
    wiremock: wiremock ? 'ok' : 'error',
    lastSyncAt: rt.reconciler?.lastSyncAt?.toISOString() ?? null,
    lastSyncError: rt.reconciler?.lastError ? 'sync failed; see logs' : null,
  }
  return json(body, store && wiremock ? 200 : 503)
})
