import { defineConfig } from '@playwright/test';

const CLAMD_PORT = process.env.E2E_CLAMD_PORT ?? '58310';
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? 'e2e-cron-secret-0123456789abcdef';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const PORT = new URL(BASE_URL).port || '3000';

/**
 * UI journey capture (not a test suite): one laptop-sized walk through the whole platform, saving a screenshot at every
 * step to test-results/journey. Run: `npx playwright test -c playwright.journey.config.ts`, then `node scripts/journey-pdf.mjs`.
 */
export default defineConfig({
  testDir: './tests/journey',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 1_200_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/journey-artifacts',
  reporter: [['list']],
  use: { baseURL: BASE_URL, actionTimeout: 20_000, navigationTimeout: 40_000, locale: 'en-US' },
  projects: [{ name: 'laptop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `${BASE_URL}/api/v1/health`,
    env: { CLAMD_HOST: '127.0.0.1', CLAMD_PORT, CRON_SECRET },
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
