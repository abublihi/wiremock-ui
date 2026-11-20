import { expect, type Page } from '@playwright/test'

/** Signs in through the login form and waits for the app shell. */
export async function signIn(page: Page, user: { username: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username').fill(user.username)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
}
