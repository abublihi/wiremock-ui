import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { E2E_UI_URL, USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

/** Fails on serious or critical axe violations (WCAG 2.x A/AA rules), listing each offending node. */
async function expectNoSeriousViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(' ')}: ${n.html.slice(0, 160)}\n    ${n.failureSummary?.replace(/\n/g, ' ')}`).join('\n')}`)
  expect(report, report.join('\n')).toEqual([])
}

// Entrance animations fade colours in; axe must measure the settled page.
test.use({ reducedMotion: 'reduce' })

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })
    // The app defaults to dark without a cookie, so colorScheme alone would test dark twice.
    test.beforeEach(async ({ context }) => {
      await context.addCookies([{ name: 'wmui_theme', value: theme, url: E2E_UI_URL }])
    })

    test('login page', async ({ page }) => {
      await page.goto('/login')
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
      await expectNoSeriousViolations(page)
    })

    test('signed-in pages', async ({ page }) => {
      await signIn(page, USER_A)
      const pages: [string, string | RegExp][] = [
        ['/mocks?owner=all', 'Mocks'],
        ['/mocks/new?integration=nic&endpoint=fetch-citizen', 'New mock'],
        ['/requests', 'Request log'],
        ['/scenarios', 'Scenarios'],
        ['/integrations', 'Integrations'],
        ['/catalog', 'Integrations'], // the old URL redirects
        ['/integrations/nic', 'NIC'],
        ['/integrations/nic/endpoints/new', 'Add endpoint'],
        ['/integrations/nic/endpoints/fetch-citizen/edit', 'Edit endpoint'],
        ['/users', 'Users'],
      ]
      for (const [url, heading] of pages) {
        await test.step(url, async () => {
          await page.goto(url)
          await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
          await page.waitForLoadState('networkidle')
          await expectNoSeriousViolations(page)
        })
      }
    })

    test('the new-mock page with no integrations, and with one that has no endpoints yet', async ({ page }) => {
      await signIn(page, USER_A)
      await page.route('**/api/integrations', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback()))
      await page.goto('/mocks/new')
      await expect(page.getByText('No integrations yet')).toBeVisible()
      await expectNoSeriousViolations(page)
      await page.unroute('**/api/integrations')
      // NIC answers with no endpoints: the picker shows "No endpoints yet — Add one" instead of a list.
      await page.route('**/api/integrations/nic/endpoints', (r) => r.fulfill({ json: [] }))
      await page.goto('/mocks/new')
      await expect(page.getByRole('link', { name: 'Add one endpoint to NIC' })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expectNoSeriousViolations(page)
    })

    test('the mock editor of an existing mock', async ({ page }) => {
      await signIn(page, USER_A)
      await page.goto('/mocks?owner=all')
      await page.getByRole('link', { name: 'NIC health (baseline)' }).click()
      await expect(page.getByRole('tab', { name: 'Advanced' })).toBeVisible()
      await expectNoSeriousViolations(page)
      await page.getByRole('tab', { name: 'Advanced' }).click()
      await expect(page.getByRole('textbox', { name: 'Stub JSON' })).toBeVisible()
      await expectNoSeriousViolations(page)
    })

    test('a request with its near misses', async ({ page }) => {
      await fetch(`${wiremockUrl()}/nic/citizens/fetch`, { method: 'POST', body: JSON.stringify({ idNo: `a11y-${theme}` }) })
      await signIn(page, USER_A)
      await page.goto('/requests')
      await page.getByRole('button', { name: 'No match — see why' }).first().click()
      await expect(page.getByRole('heading', { name: 'Near misses' })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expectNoSeriousViolations(page)
    })
  })
}

test('closing a dialog returns focus to the button that opened it', async ({ page }) => {
  await signIn(page, USER_A)
  const cases: [string, string, string][] = [
    ['/users', 'Add user', 'Add user'],
    ['/integrations', 'Add integration', 'Add integration'],
  ]
  for (const [url, trigger, title] of cases) {
    await test.step(`${url}: ${trigger}`, async () => {
      await page.goto(url)
      const button = page.getByRole('button', { name: trigger }).first()
      await button.click()
      const dialog = page.getByRole('dialog', { name: title })
      await expect(dialog).toBeVisible()
      await expectNoSeriousViolations(page)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(button).toBeFocused()
    })
  }

  await test.step('/mocks: row actions menu and delete confirmation', async () => {
    await page.goto('/mocks?owner=all')
    const actions = page.getByRole('button', { name: 'Actions for NIC health (baseline)' })
    await actions.click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    await expect(actions).toBeFocused()
  })
})
