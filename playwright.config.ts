import { defineConfig, devices } from '@playwright/test'
import { E2E_UI_URL } from './e2e/env'

// One stack (WireMock container + the built app on SQLite) is shared by every spec,
// so specs run one at a time. `npm run test:e2e` builds the app first.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: E2E_UI_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
