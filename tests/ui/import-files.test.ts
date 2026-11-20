import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  ImportFileError,
  MAX_IMPORT_BYTES,
  MAX_ZIP_ENTRIES,
  isFolderJson,
  isSafeEntryPath,
  mergeResults,
  parseSourceFile,
  readZip,
} from '@/ui/lib/import-files'

const stub = (path: string) => ({ request: { method: 'GET', urlPath: path }, response: { status: 200 } })
const json = (v: unknown) => strToU8(JSON.stringify(v))

describe('zip entries', () => {
  it('refuses absolute paths and .. segments (zip slip)', () => {
    expect(isSafeEntryPath('mappings/a.json')).toBe(true)
    expect(isSafeEntryPath('/etc/a.json')).toBe(false)
    expect(isSafeEntryPath('\\evil\\a.json')).toBe(false)
    expect(isSafeEntryPath('C:/a.json')).toBe(false)
    expect(isSafeEntryPath('../a.json')).toBe(false)
    expect(isSafeEntryPath('a/../../b.json')).toBe(false)
    expect(isSafeEntryPath('a\\..\\b.json')).toBe(false)
  })

  it('reads .json entries in path order and skips unsafe, hidden and other files', () => {
    const zip = zipSync({
      'mappings/b.json': json(stub('/b')),
      'mappings/a.json': json(stub('/a')),
      '../evil.json': json(stub('/evil')),
      '/abs.json': json(stub('/abs')),
      '__MACOSX/mappings/._a.json': strToU8('binary junk'),
      '.hidden/c.json': json(stub('/c')),
      'readme.txt': strToU8('hello'),
    })
    const { files, skipped } = readZip(zip, 'mocks.zip')
    expect(files.map((f) => f.path)).toEqual(['mocks.zip/mappings/a.json', 'mocks.zip/mappings/b.json'])
    expect(skipped).toEqual(expect.arrayContaining(['../evil.json', '/abs.json']))
    expect(JSON.parse(files[0].text)).toEqual(stub('/a'))
  })

  it('refuses more than 2,000 entries', () => {
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) entries[`m/${i}.json`] = json(stub(`/${i}`))
    expect(() => readZip(zipSync(entries), 'big.zip')).toThrow(ImportFileError)
    try {
      readZip(zipSync(entries), 'big.zip')
    } catch (e) {
      expect((e as ImportFileError).key).toBe('import.zipTooManyEntries')
    }
  })

  it('refuses more than 10 MB unpacked (a zip bomb compresses well)', () => {
    const zip = zipSync({ 'a.json': new Uint8Array(MAX_IMPORT_BYTES + 1).fill(32) })
    expect(zip.length).toBeLessThan(MAX_IMPORT_BYTES)
    expect(() => readZip(zip, 'bomb.zip')).toThrow(expect.objectContaining({ key: 'import.zipTooLarge' }))
  })

  it('names a file that is not a zip', () => {
    expect(() => readZip(strToU8('not a zip'), 'x.zip')).toThrow(expect.objectContaining({ key: 'import.zipUnreadable' }))
  })
})

describe('folders', () => {
  it('keeps .json files only and skips dotfiles and dot folders', () => {
    expect(isFolderJson('mocks/a.json')).toBe(true)
    expect(isFolderJson('mocks/A.JSON')).toBe(true)
    expect(isFolderJson('mocks/a.txt')).toBe(false)
    expect(isFolderJson('mocks/.a.json')).toBe(false)
    expect(isFolderJson('mocks/.git/a.json')).toBe(false)
  })
})

describe('parsing and merging', () => {
  it('parses a mixed folder: bundle, WireMock export, stub, array and a broken file', () => {
    const results = [
      parseSourceFile({ path: 'm/4-broken.json', text: '{ nope' }),
      parseSourceFile({ path: 'm/1-bundle.json', text: JSON.stringify({ integrations: [{ key: 'a' }], catalog: [{}], mocks: [stub('/1')] }) }),
      parseSourceFile({ path: 'm/2-export.json', text: JSON.stringify({ mappings: [stub('/2a'), stub('/2b')] }) }),
      parseSourceFile({ path: 'm/3-stub.json', text: JSON.stringify(stub('/3')) }),
      parseSourceFile({ path: 'm/5-array.json', text: JSON.stringify([stub('/5')]) }),
      parseSourceFile({ path: 'm/6-other.json', text: JSON.stringify({ hello: 1 }) }),
      parseSourceFile({ path: 'm/7-bad-field.json', text: JSON.stringify({ mocks: 'x' }) }),
    ]
    expect(results.map((r) => (r.ok ? r.summary : r.error.key))).toEqual([
      'import.invalidJson',
      { integrations: 1, endpoints: 1, mocks: 1, oidcIdentities: 0 },
      { integrations: 0, endpoints: 0, mocks: 2, oidcIdentities: 0 },
      { integrations: 0, endpoints: 0, mocks: 1, oidcIdentities: 0 },
      { integrations: 0, endpoints: 0, mocks: 1, oidcIdentities: 0 },
      'import.fileShape',
      'import.fileShape',
    ])
    const bad = results[6]
    expect(!bad.ok && bad.error.params.message).toMatch(/mocks must be an array/)
  })

  it('merges in path order whatever order the files came in', () => {
    const results = ['m/b.json', 'm/a.json', 'm/sub/c.json'].map((path) => parseSourceFile({ path, text: JSON.stringify(stub(`/${path}`)) }))
    const { bundle, bytes } = mergeResults(results)
    expect(bundle.mocks.map((m) => m.request.urlPath)).toEqual(['/m/a.json', '/m/b.json', '/m/sub/c.json'])
    expect(bytes).toBe(new TextEncoder().encode(JSON.stringify(bundle)).length)
  })
})
