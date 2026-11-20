import { describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import {
  type BuilderDraft,
  type BuilderStep,
  hasErrors,
  moveStep,
  newStep,
  previewScenario,
  removeStep,
  stepState,
  targetOf,
  toCreates,
  validateDraft,
} from '@/ui/lib/scenario-builder'

const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
const endpoint: Endpoint = {
  integration: 'nic',
  key: 'loan',
  name: 'Loan status',
  method: 'GET',
  path: '/loan/status',
  pathType: 'exact',
  lookup: { location: 'query', expression: 'id' },
  contentType: 'json',
  exampleResponses: { '200': '{"status":"pending"}' },
  allowedStatuses: [200, 404],
  updatedAt: '',
  updatedBy: '',
}

const step = (id: string, over: Partial<BuilderStep> = {}): BuilderStep => ({ ...newStep(id), ...over })
const draft = (over: Partial<BuilderDraft> = {}): BuilderDraft => ({
  name: 'loan-approval',
  request: { kind: 'catalog', integration, endpoint, isDefault: false, keyValue: '7' },
  steps: [step('a', { body: '{"status":"pending"}' }), step('b', { state: 'approved', body: '{"status":"approved"}' })],
  ...over,
})

describe('scenario builder: states and moves', () => {
  it('step 1 is always Started; "then move to" defaults to the next step, and the last step stays', () => {
    const steps = [step('a', { state: 'ignored' }), step('b', { state: 'paid' }), step('c', { state: 'shipped' })]
    expect(steps.map((_, i) => stepState(steps, i))).toEqual(['Started', 'paid', 'shipped'])
    expect(steps.map((_, i) => targetOf(steps, i))).toEqual(['paid', 'shipped', undefined])
  })

  it('a step can stay, or move to any step (by id, so renaming that step keeps the move)', () => {
    const steps = [step('a', { moveTo: 'stay' }), step('b', { state: 'paid', moveTo: 'step:a' }), step('c', { state: 'x', moveTo: 'step:c' })]
    expect(steps.map((_, i) => targetOf(steps, i))).toEqual([undefined, 'Started', undefined])
    steps[0] = { ...steps[0], moveTo: 'step:b' }
    steps[1] = { ...steps[1], state: 'settled' }
    expect(targetOf(steps, 0)).toBe('settled')
  })

  it('removing a step resets the moves that pointed at it; moving swaps neighbours', () => {
    const steps = [step('a', { moveTo: 'step:c' }), step('b', { state: 'b' }), step('c', { state: 'c' })]
    const removed = removeStep(steps, 'c')
    expect(removed.map((s) => s.id)).toEqual(['a', 'b'])
    expect(removed[0].moveTo).toBe('next')
    expect(moveStep(steps, 'c', -1).map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(moveStep(steps, 'a', -1)).toBe(steps)
    expect(moveStep(steps, 'c', 1)).toBe(steps)
  })

  it('a step moving into first place answers in Started and hands its state name to the step it displaces', () => {
    const steps = [step('a'), step('b', { state: 'paid' }), step('c', { state: 'shipped' })]
    const moved = moveStep(steps, 'b', -1)
    expect(moved.map((s) => [s.id, s.state])).toEqual([['b', ''], ['a', 'paid'], ['c', 'shipped']])
    expect(moved.map((_, i) => stepState(moved, i))).toEqual(['Started', 'paid', 'shipped'])
    expect(moveStep(moved, 'b', 1).map((s) => [s.id, s.state])).toEqual([['a', ''], ['b', 'paid'], ['c', 'shipped']])
  })
})

describe('scenario builder: validation', () => {
  it('a complete draft has no errors', () => {
    expect(hasErrors(validateDraft(draft()))).toBe(false)
  })

  it('names the missing scenario name, a name WireMock cannot address, the key, and each bad step field', () => {
    expect(validateDraft(draft({ name: ' ' })).name?.key).toBe('builder.nameRequired')
    expect(validateDraft(draft({ name: 'loan approval' })).name?.key).toBe('builder.nameUnsettable')
    expect(validateDraft(draft({ request: null })).request?.key).toBe('builder.requestRequired')
    expect(validateDraft(draft({ request: { kind: 'catalog', integration, endpoint, isDefault: false, keyValue: ' ' } })).request?.key).toBe(
      'builder.keyRequired',
    )
    expect(validateDraft(draft({ request: { kind: 'free', method: 'GET', url: 'orders/1' } })).request?.key).toBe('builder.urlInvalid')

    const errors = validateDraft(
      draft({
        steps: [
          step('a', { status: '700', body: '{nope' }),
          step('b', { state: '', delayMs: '-1' }),
          step('c', { state: 'Started', status: '500', headers: [{ name: '', value: 'x' }] }),
          step('d', { state: 'dup' }),
          step('e', { state: 'dup' }),
        ],
      }),
    )
    expect(errors.steps.a).toEqual({ status: { key: 'builder.statusRange' }, body: { key: 'builder.bodyJson' } })
    expect(errors.steps.b).toEqual({ state: { key: 'builder.stateRequired' }, delay: { key: 'builder.delayRange' } })
    expect(errors.steps.c?.state?.key).toBe('builder.stateStarted')
    expect(errors.steps.c?.status).toEqual({ key: 'builder.statusNotAllowed', vars: { allowed: '200, 404' } })
    expect(errors.steps.c?.headers?.key).toBe('editor.headers.unnamed')
    expect(errors.steps.e?.state).toEqual({ key: 'builder.stateDuplicate', vars: { state: 'dup' } })
    expect(errors.steps.d).toBeUndefined()
  })

  it('a free-form request skips the catalog checks (any status, any body)', () => {
    const free = draft({ request: { kind: 'free', method: 'POST', url: '/orders/1?x=1' }, steps: [step('a', { status: '418', body: 'plain' })] })
    expect(hasErrors(validateDraft(free))).toBe(false)
  })
})

describe('scenario builder: what Save sends', () => {
  it('a catalog request: one Simple input per step, through the catalog builder', () => {
    const creates = toCreates(
      draft({
        steps: [
          step('a', { body: '{"status":"pending"}', delayMs: '250', headers: [{ name: 'X-Step', value: '1' }] }),
          step('b', { state: 'approved', status: '404', body: '' }),
        ],
      }),
    )
    expect(creates).toEqual([
      {
        step: 1,
        state: 'Started',
        kind: 'catalog',
        args: {
          integration: 'nic',
          endpoint: 'loan',
          input: {
            keyValue: '7',
            status: 200,
            body: '{"status":"pending"}',
            headers: { 'X-Step': '1' },
            delayMs: 250,
            name: 'loan-approval — Started',
            scenario: { name: 'loan-approval', requiredState: 'Started', newState: 'approved' },
          },
        },
      },
      {
        step: 2,
        state: 'approved',
        kind: 'catalog',
        args: {
          integration: 'nic',
          endpoint: 'loan',
          input: { keyValue: '7', status: 404, name: 'loan-approval — approved', scenario: { name: 'loan-approval', requiredState: 'approved' } },
        },
      },
    ])
  })

  it('a default catalog mock sends isDefault instead of a key', () => {
    const [first] = toCreates(draft({ request: { kind: 'catalog', integration, endpoint, isDefault: true, keyValue: 'ignored' } }))
    expect(first.kind === 'catalog' && first.args.input.isDefault).toBe(true)
    expect(first.kind === 'catalog' && 'keyValue' in first.args.input).toBe(false)
  })

  it('a free-form request: a full stub per step (urlPath, or url with a query; JSON bodies get a JSON Content-Type)', () => {
    const creates = toCreates(
      draft({
        name: 'order',
        request: { kind: 'free', method: 'GET', url: ' /orders/1 ' },
        steps: [step('a', { body: '{"status":"pending"}', delayMs: '100' }), step('b', { state: 'done', body: 'done', headers: [{ name: 'Content-Type', value: 'text/plain' }] })],
      }),
    )
    expect(creates.map((c) => (c.kind === 'free' ? c.stub : null))).toEqual([
      {
        name: 'order — Started',
        request: { method: 'GET', urlPath: '/orders/1' },
        response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"status":"pending"}', fixedDelayMilliseconds: 100 },
        scenarioName: 'order',
        requiredScenarioState: 'Started',
        newScenarioState: 'done',
      },
      {
        name: 'order — done',
        request: { method: 'GET', urlPath: '/orders/1' },
        response: { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'done' },
        scenarioName: 'order',
        requiredScenarioState: 'done',
      },
    ])
    const [withQuery] = toCreates(draft({ request: { kind: 'free', method: 'GET', url: '/orders?id=1' }, steps: [step('a')] }))
    expect(withQuery.kind === 'free' && withQuery.stub.request).toEqual({ method: 'GET', url: '/orders?id=1' })
  })
})

describe('scenario builder: the live diagram', () => {
  it('shows the steps as states in order and each step as the move it makes', () => {
    const preview = previewScenario(draft({ steps: [step('a'), step('b', { state: 'approved' }), step('c', { state: '' })] }))
    expect(preview.possibleStates).toEqual(['Started', 'approved', 'Step 3'])
    expect(preview.mocks).toEqual([
      { id: 'a', name: 'Step 1', method: 'GET', url: '/nic/loan/status', requiredState: 'Started', newState: 'approved' },
      { id: 'b', name: 'Step 2', method: 'GET', url: '/nic/loan/status', requiredState: 'approved', newState: 'Step 3' },
      { id: 'c', name: 'Step 3', method: 'GET', url: '/nic/loan/status', requiredState: 'Step 3' },
    ])
  })
})
