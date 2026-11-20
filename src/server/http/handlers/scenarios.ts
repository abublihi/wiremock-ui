import { z } from 'zod'
import { ValidationError } from '../../errors'
import { json, parse, readJson, requireJson, withAuth, type Params } from '../wrap'

const nameOf = (params?: Params) => {
  if (!params?.name) throw new ValidationError('scenario name is required')
  return params.name
}

const stateBody = z.object(
  { state: z.string({ error: 'state must be a string' }).min(1, 'state must not be empty') },
  { error: 'body must be an object' },
)
const resetBody = z.object(
  { name: z.string({ error: 'name must be a string' }).min(1, 'name must not be empty').optional() },
  { error: 'body must be an object' },
)

/** GET /api/scenarios → { scenarios: Scenario[] } (names and states from the mocks, live state from WireMock). */
export const listScenarios = withAuth(null, async ({ rt }) => json({ scenarios: await rt.scenarios.list() }))

/** PUT /api/scenarios/:name/state { state } → the scenario. 404 unknown scenario, 400 a state it does not have. */
export const setScenarioState = withAuth(null, async ({ rt, request, params, principal }) => {
  requireJson(request)
  const { state } = parse(stateBody, await readJson(request))
  return json(await rt.scenarios.setState(nameOf(params), state, principal.user.username))
})

/** POST /api/scenarios/reset {} resets every scenario; { name } resets one (sets it to Started). */
export const resetScenarios = withAuth(null, async ({ rt, request, principal }) => {
  requireJson(request)
  const { name } = parse(resetBody, await readJson(request))
  if (name !== undefined) await rt.scenarios.setState(name, 'Started', principal.user.username)
  else await rt.scenarios.resetAll(principal.user.username)
  return new Response(null, { status: 204 })
})
