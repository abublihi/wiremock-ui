import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }
const IDS = ['6f1c1a52-0b6e-4d5e-9b0a-6c1f0e9a0001', '6f1c1a52-0b6e-4d5e-9b0a-6c1f0e9a0002']
const stub = (id: string, path: string, body: string) => ({ id, name: `Folder ${path}`, request: { method: 'GET', urlPath: path }, response: { status: 200, body } })

let dir: string
let made: string[] = []
test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wmui-e2e-folder-'))
  const root = join(dir, 'mocks')
  mkdirSync(join(root, 'sub'), { recursive: true })
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, 'one.json'), JSON.stringify({ mappings: [stub(IDS[0], '/folder/one', 'one')] }))
  writeFileSync(join(root, 'sub', 'two.json'), JSON.stringify(stub(IDS[1], '/folder/two', 'two')))
  writeFileSync(join(root, '.hidden.json'), '{ not json')
  writeFileSync(join(root, '.git', 'x.json'), '{ not json')
  writeFileSync(join(root, 'readme.md'), '# not a mock')
})
test.afterAll(async ({ request }) => {
  rmSync(dir, { recursive: true, force: true })
  for (const id of [...IDS, ...made]) {
    const res = await request.get(`/api/mocks/${id}`, { headers: AUTH })
    if (!res.ok()) continue
    const version = ((await res.json()) as { metadata: { wiremockUi: { version: number } } }).metadata.wiremockUi.version
    await request.delete(`/api/mocks/${id}?version=${version}`, { headers: AUTH })
  }
})

test('a chosen folder is listed file by file, imported in one go and served by WireMock; export holds it', async ({ page, request }) => {
  await signIn(page, USER_A)
  await page.goto('/import')
  await page.getByLabel('Choose folder').setInputFiles(join(dir, 'mocks'))
  const files = page.getByRole('list', { name: 'Files' })
  await expect(files.getByRole('listitem')).toHaveCount(2)
  await expect(files.getByText('mocks/one.json')).toBeVisible()
  await expect(files.getByText('mocks/sub/two.json')).toBeVisible()
  await page.getByRole('button', { name: 'Import' }).click()
  const report = page.getByRole('region', { name: 'Import finished' })
  await expect(report).toBeVisible()
  await expect(report.getByText('Created', { exact: true }).locator('xpath=following-sibling::dd')).toHaveText('2')

  expect(await (await fetch(`${wiremockUrl()}/folder/one`)).text()).toBe('one')
  expect(await (await fetch(`${wiremockUrl()}/folder/two`)).text()).toBe('two')

  // Both export formats carry the imported mocks.
  const bundle = await request.get('/api/export?scope=all&format=bundle', { headers: AUTH })
  expect(bundle.headers()['content-disposition']).toMatch(/^attachment; filename="wiremock-ui-all-/)
  const ids = ((await bundle.json()) as { mocks: { id: string }[] }).mocks.map((m) => m.id)
  expect(ids).toEqual(expect.arrayContaining(IDS))
  const zip = unzipSync(new Uint8Array(await (await request.get('/api/export?format=mappings', { headers: AUTH })).body()))
  expect(Object.keys(zip)).toEqual(expect.arrayContaining([`mappings/folder-folder-one-${IDS[0]}.json`, `mappings/folder-folder-two-${IDS[1]}.json`]))
})

test('a PNG uploaded as the body in Simple mode comes back from WireMock byte for byte', async ({ page }) => {
  const png = Buffer.concat([
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
    Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
  ])
  await signIn(page, USER_A)
  await page.goto('/mocks/new')
  await page.getByRole('textbox', { name: 'URL' }).fill('/e2e-files/photo')
  await page.getByLabel('Upload body from file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('group', { name: 'Binary body' })).toContainText('photo.png')
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page).toHaveURL(/\/mocks\/[0-9a-f-]{36}$/)
  made.push(page.url().split('/').pop()!)

  const res = await fetch(`${wiremockUrl()}/e2e-files/photo`)
  expect(res.headers.get('content-type')).toBe('image/png')
  expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
  // The saved mock reopens in Simple mode, showing the binary body by size and type.
  await page.reload()
  await expect(page.getByRole('group', { name: 'Binary body' })).toContainText('image/png')
})
