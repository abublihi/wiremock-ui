import { describe, expect, it } from 'vitest'
import { BodyFileError, MAX_BODY_FILE_BYTES, applyBodyFile, base64Size, bytesToBase64, contentTypeFor, isTextLike, readBodyFile } from '@/ui/lib/body-file'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 256 }, (_, i) => i)])

describe('file kinds', () => {
  it('treats json, xml, txt, html and csv as text, anything else as binary', () => {
    for (const name of ['a.json', 'a.XML', 'a.txt', 'a.html', 'a.htm', 'a.csv']) expect(isTextLike({ name, type: '' })).toBe(true)
    for (const name of ['a.png', 'a.pdf', 'a.bin', 'a', 'a.svg']) expect(isTextLike({ name, type: '' })).toBe(false)
    expect(isTextLike({ name: 'noext', type: 'text/plain' })).toBe(true)
  })

  it('takes the Content-Type from the file, else from the extension, else octet-stream', () => {
    expect(contentTypeFor({ name: 'a.png', type: 'image/png' })).toBe('image/png')
    expect(contentTypeFor({ name: 'a.json', type: '' })).toBe('application/json')
    expect(contentTypeFor({ name: 'a.csv', type: '' })).toBe('text/csv')
    expect(contentTypeFor({ name: 'a.pdf', type: '' })).toBe('application/pdf')
    expect(contentTypeFor({ name: 'mystery', type: '' })).toBe('application/octet-stream')
  })

  it('encodes every byte value to base64 and knows the decoded size', () => {
    const b64 = bytesToBase64(PNG)
    expect(b64).toBe(Buffer.from(PNG).toString('base64'))
    expect(base64Size(b64)).toBe(PNG.length)
    // Large inputs are encoded in chunks (no call-stack overflow).
    const big = new Uint8Array(300_000).fill(7)
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'))
  })
})

describe('reading a file', () => {
  it('reads text files as text and the rest as base64', async () => {
    expect(await readBodyFile(new File(['{"a":1}'], 'a.json', { type: 'application/json' }))).toEqual({
      kind: 'text', text: '{"a":1}', name: 'a.json', size: 7, contentType: 'application/json',
    })
    expect(await readBodyFile(new File([PNG], 'logo.png', { type: 'image/png' }))).toEqual({
      kind: 'binary', base64: Buffer.from(PNG).toString('base64'), name: 'logo.png', size: PNG.length, contentType: 'image/png',
    })
  })

  it('refuses files over 5 MB', async () => {
    const big = new File(['x'], 'big.png')
    Object.defineProperty(big, 'size', { value: MAX_BODY_FILE_BYTES + 1 })
    await expect(readBodyFile(big)).rejects.toBeInstanceOf(BodyFileError)
  })
})

describe('into a stub (Advanced mode)', () => {
  const base = { request: { method: 'GET', urlPath: '/x' }, response: { status: 200, body: 'old', jsonBody: { old: true }, base64Body: 'AA==' } }

  it('a JSON file becomes jsonBody and sets the Content-Type', () => {
    const out = applyBodyFile(base, { kind: 'text', text: '{"a":1}', name: 'a.json', size: 7, contentType: 'application/json' })
    expect(out.response).toEqual({ status: 200, jsonBody: { a: 1 }, headers: { 'Content-Type': 'application/json' } })
  })

  it('a JSON file that does not parse stays a text body', () => {
    const out = applyBodyFile(base, { kind: 'text', text: '{nope', name: 'a.json', size: 5, contentType: 'application/json' })
    expect(out.response).toEqual({ status: 200, body: '{nope', headers: { 'Content-Type': 'application/json' } })
  })

  it('a text file becomes body; a Content-Type the user set is kept', () => {
    const stub = { ...base, response: { ...base.response, headers: { 'content-type': 'text/x-mine', 'X-A': '1' } } }
    const out = applyBodyFile(stub, { kind: 'text', text: 'a,b', name: 'a.csv', size: 3, contentType: 'text/csv' })
    expect(out.response).toEqual({ status: 200, body: 'a,b', headers: { 'content-type': 'text/x-mine', 'X-A': '1' } })
  })

  it('a binary file becomes base64Body with its Content-Type', () => {
    const out = applyBodyFile({ request: {}, response: { status: 201 } }, { kind: 'binary', base64: 'iVBORw==', name: 'a.png', size: 4, contentType: 'image/png' })
    expect(out.response).toEqual({ status: 201, base64Body: 'iVBORw==', headers: { 'Content-Type': 'image/png' } })
  })

  it('works on a stub without a response object', () => {
    const out = applyBodyFile({ request: {} }, { kind: 'text', text: 'hi', name: 'a.txt', size: 2, contentType: 'text/plain' })
    expect(out.response).toEqual({ body: 'hi', headers: { 'Content-Type': 'text/plain' } })
  })
})
