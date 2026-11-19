import { json, withErrors } from '../wrap'

export const healthz = withErrors(async (rt) => {
  const [store, wiremock] = await Promise.all([
    Promise.race([
      rt.store.ping(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000).unref()),
    ]).catch(() => false),
    rt.wiremock.ping().catch(() => false),
  ])
  const body = {
    ui: 'ok',
    store: store ? 'ok' : 'error',
    wiremock: wiremock ? 'ok' : 'error',
    lastSyncAt: rt.reconciler.lastSyncAt?.toISOString() ?? null,
    lastSyncError: rt.reconciler.lastError ? 'sync failed; see logs' : null,
  }
  return json(body, store && wiremock ? 200 : 503)
})
