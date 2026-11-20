import { expect, test } from 'vitest'
import { AppError } from '../../src/server/errors'
import { readJsonCapped } from '../../src/server/http/wrap'

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://x/api', { method: 'POST', body, headers, duplex: 'half' } as RequestInit)

test('reads JSON under the cap; over it → 413 with the given message, with or without Content-Length', async () => {
  expect(await readJsonCapped(post('{"a":1}'), 100, 'too big')).toEqual({ a: 1 })
  await expect(readJsonCapped(post('x'.repeat(10), { 'content-length': '200' }), 100, 'too big')).rejects.toMatchObject({ status: 413, message: 'too big' })
  const chunked = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('['.padEnd(80, ' ')))
      c.enqueue(new TextEncoder().encode(' '.repeat(80)))
      c.close()
    },
  })
  await expect(readJsonCapped(post(chunked), 100, 'too big')).rejects.toMatchObject({ status: 413 })
})

test('a body that breaks off is a 400, not a 500; bad JSON is a 400', async () => {
  const broken = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"a":'))
      c.error(new Error('socket hang up'))
    },
  })
  const err = await readJsonCapped(post(broken), 100, 'too big').catch((e: unknown) => e)
  expect(err).toBeInstanceOf(AppError)
  expect(err).toMatchObject({ status: 400 })
  await expect(readJsonCapped(post('{'), 100, 'too big')).rejects.toMatchObject({ status: 400, message: 'Request body must be valid JSON' })
})
