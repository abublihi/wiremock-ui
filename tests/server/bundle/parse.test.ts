import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseBundle, readBundleFromPath } from '../../../src/server/bundle/parse'
import { ValidationError } from '../../../src/server/errors'

const stub = (n: number) => ({ request: { method: 'GET', urlPath: `/s${n}` }, response: { status: 200 } })

test('bundle shape', () => {
  const b = parseBundle({ integrations: [{ key: 'a' }], mocks: [stub(1)], oidcIdentities: [{}] }, 'x')
  expect(b.integrations).toHaveLength(1)
  expect(b.mocks).toHaveLength(1)
  expect(b.catalog).toEqual([])
  expect(b.oidcIdentities).toHaveLength(1)
})

test('WireMock export shape', () => {
  expect(parseBundle({ mappings: [stub(1), stub(2)], meta: { total: 2 } }, 'x').mocks).toHaveLength(2)
})

test('single stub and array of stubs', () => {
  expect(parseBundle(stub(1), 'x').mocks).toHaveLength(1)
  expect(parseBundle([stub(1), stub(2)], 'x').mocks).toHaveLength(2)
})

test('unknown shape is a ValidationError naming the source', () => {
  expect(() => parseBundle({ hello: 1 }, 'my.json')).toThrow(ValidationError)
  expect(() => parseBundle('nope', 'my.json')).toThrow(/my\.json/)
  expect(() => parseBundle({ mocks: 'x' }, 'my.json')).toThrow(/my\.json: mocks must be an array/)
})

test('folder: recursive, sorted by path, ignores dotfiles and non-json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'))
  await mkdir(join(dir, 'b'))
  await mkdir(join(dir, 'a'))
  await writeFile(join(dir, 'b', 'one.json'), JSON.stringify(stub(3)))
  await writeFile(join(dir, 'a', 'two.json'), JSON.stringify([stub(2)]))
  await writeFile(join(dir, 'a', '.hidden.json'), JSON.stringify(stub(9)))
  await writeFile(join(dir, 'a', 'readme.txt'), 'x')
  await writeFile(join(dir, '0.json'), JSON.stringify({ mappings: [stub(1)] }))
  const { bundle: b, skipped } = await readBundleFromPath(dir)
  expect(skipped).toEqual([])
  expect(b.mocks.map((m) => (m.request as { urlPath: string }).urlPath)).toEqual(['/s1', '/s2', '/s3'])
})

test('file path and bad JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'))
  await writeFile(join(dir, 'ok.json'), JSON.stringify(stub(1)))
  await writeFile(join(dir, 'bad.json'), '{')
  expect((await readBundleFromPath(join(dir, 'ok.json'))).bundle.mocks).toHaveLength(1)
  await expect(readBundleFromPath(join(dir, 'bad.json'))).rejects.toThrow(/bad\.json: invalid JSON/)
  await expect(readBundleFromPath(join(dir, 'missing'))).rejects.toThrow(ValidationError)
})

test('ConfigMap-like symlink layout is read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'))
  await mkdir(join(dir, '..2026_x'))
  await writeFile(join(dir, '..2026_x', 'a.json'), JSON.stringify(stub(1)))
  await writeFile(join(dir, '..2026_x', 'b.json'), JSON.stringify(stub(2)))
  await symlink('..2026_x', join(dir, '..data'))
  await symlink('..data/a.json', join(dir, 'a.json'))
  await symlink('..data/b.json', join(dir, 'b.json'))
  const { bundle: b } = await readBundleFromPath(dir)
  expect(b.mocks.map((m) => (m.request as { urlPath: string }).urlPath)).toEqual(['/s1', '/s2'])
})

test('a symlink loop does not hang', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'))
  await mkdir(join(dir, 'sub'))
  await writeFile(join(dir, 'sub', 'a.json'), JSON.stringify(stub(1)))
  await symlink('..', join(dir, 'sub', 'loop'))
  expect((await readBundleFromPath(dir)).bundle.mocks).toHaveLength(1)
})

test('a folder without .json files is an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'))
  await writeFile(join(dir, 'x.txt'), 'x')
  await expect(readBundleFromPath(dir)).rejects.toThrow(/contains no \.json files/)
})

test('dangling symlinks are skipped and reported', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-'))
  await writeFile(join(dir, 'a.json'), JSON.stringify(stub(1)))
  await symlink(join(dir, 'gone.json'), join(dir, 'dangling.json'))
  const r = await readBundleFromPath(dir)
  expect(r.bundle.mocks).toHaveLength(1)
  expect(r.skipped).toEqual(['dangling.json'])
})
