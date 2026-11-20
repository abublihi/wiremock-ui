import { ValidationError } from '../../errors'
import { acceptSchema, discardSchema, snapshotSchema, startSchema } from '../../recording/service'
import { idOf, json, parse, readJson, requireJson, withAuth } from '../wrap'

// Spec A12. No roles (A8): every signed-in user may record; RECORDING_ALLOWED=false answers 403 everywhere here.

/** GET /api/recordings/status → { status: 'recording', target, startedBy, startedAt } | { status: 'idle' }. */
export const recordingStatus = withAuth(null, async ({ rt }) => {
  rt.recordings.assertAllowed()
  return json(await rt.recordings.state())
})

/** POST /api/recordings/start { targetUrl, method?, urlPathPattern?, captureHeaders?, repeatsAsScenarios? } → the state. */
export const startRecording = withAuth(null, async ({ rt, request, principal }) => {
  rt.recordings.assertAllowed()
  requireJson(request)
  const input = parse(startSchema, await readJson(request))
  // The app as WireMock might reach it: the URL this request came in on, and the app's own port on WireMock's
  // machine (all-in-one setups run both side by side).
  const own = `http://localhost:${process.env.PORT ?? 3000}`
  return json(await rt.recordings.start(input, principal.user.username, [new URL(request.url).origin, own]))
})

/** POST /api/recordings/stop → { recording } (the new review list, null when nothing was recorded). 409 when not recording. */
export const stopRecording = withAuth(null, async ({ rt, principal }) => {
  rt.recordings.assertAllowed()
  return json({ recording: await rt.recordings.stop(principal.user.username) })
})

/** POST /api/recordings/snapshot { method?, urlPathPattern?, captureHeaders?, repeatsAsScenarios?, ids? } → { recording }. */
export const snapshotRecording = withAuth(null, async ({ rt, request, principal }) => {
  rt.recordings.assertAllowed()
  requireJson(request)
  const input = parse(snapshotSchema, await readJson(request))
  return json({ recording: await rt.recordings.snapshot(input, principal.user.username) })
})

/** GET /api/recordings → { recordings }: summaries (no rows) of the review lists waiting, newest first. */
export const listRecordings = withAuth(null, async ({ rt }) => json({ recordings: await rt.recordings.list() }))

/** GET /api/recordings/:id → the review list. 404 once accepted, discarded or expired. */
export const getRecording = withAuth(null, async ({ rt, params }) => json(await rt.recordings.get(idOf(params))))

/** DELETE /api/recordings/:id discards the whole review list. */
export const deleteRecording = withAuth(null, async ({ rt, params, principal }) => {
  await rt.recordings.discard(idOf(params), undefined, principal.user.username)
  return new Response(null, { status: 204 })
})

/** POST /api/recordings/:id/discard { ids } → { recording } (what is left, null when nothing). */
export const discardRecordingItems = withAuth(null, async ({ rt, request, params, principal }) => {
  requireJson(request)
  const { ids } = parse(discardSchema, await readJson(request))
  return json({ recording: await rt.recordings.discard(idOf(params), ids, principal.user.username) })
})

/** POST /api/recordings/:id/accept { items: [{ id, name?, integration?, endpoint?, newEndpoint? }], owner? } → { created, failed, recording }. */
export const acceptRecording = withAuth(null, async ({ rt, request, params, principal }) => {
  requireJson(request)
  const input = parse(acceptSchema, await readJson(request))
  if (new Set(input.items.map((i) => i.id)).size !== input.items.length) throw new ValidationError('items must not repeat an id')
  return json(await rt.recordings.accept(idOf(params), input, principal.user))
})
