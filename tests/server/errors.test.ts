import { expect, test } from 'vitest'
import { z } from 'zod'
import { ValidationError } from '../../src/server/errors'
import { parse, withErrors } from '../../src/server/http/wrap'

test('a validation error names its field: given, from zod\'s path, or from the message\'s leading field path', async () => {
  expect(new ValidationError('x', 'lookup.expression').field).toBe('lookup.expression')
  expect(new ValidationError('keyValue is required').field).toBe('keyValue')
  expect(new ValidationError('exampleResponses.200 must be valid JSON').field).toBe('exampleResponses.200')
  expect(new ValidationError('serveEventListeners[0].parameters.url must be an http:// or https:// URL').field).toBe('serveEventListeners[0].parameters.url')
  expect(new ValidationError('Request body must be valid JSON').field).toBeUndefined()
  expect(new ValidationError('Pick an integration for the endpoint').field).toBeUndefined()
  const err = (() => {
    try {
      parse(z.object({ lookup: z.object({ expression: z.string({ error: 'needs text' }) }) }), { lookup: {} })
    } catch (e) {
      return e as ValidationError
    }
  })()
  expect(err).toMatchObject({ message: 'lookup.expression: needs text', field: 'lookup.expression' })

  const res = await withErrors(async () => {
    throw new ValidationError('name must not be empty')
  })({} as never, new Request('http://x/'))
  expect(await res.json()).toEqual({ error: 'name must not be empty', field: 'name' })
})
