import { defineConfig } from '@playwright/test';

const CLAMD_PORT = process.env.E2E_CLAMD_PORT ?? '58310';
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? 'e2e-cron-secret-0123456789abcdef';
const CI = Boolean(process.env.CI);
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const PORT = new URL(BASE_URL).port || '3000';
const buildStep = process.env.E2E_SKIP_BUILD === '1' ? '' : 'npm run build && ';

/**
 * Browser E2E for the MITRA platform. Self-contained: `npm run test:e2e`
 *  1. builds and starts the app (`next start -p 3000`, reused locally when already running),
 *  2. resets the local Supabase database (skip with E2E_NO_RESET=1) and creates the first admin (global-setup.ts),
 *  3. runs every spec at 360x740 ("mobile") and 1280x800 ("desktop"), one worker (shared DB).
 * Requires the local Supabase stack (npm run db:start) and platform/.env.local.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'en-US',
  },
  projects: [
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `${buildStep}npx next start -p ${PORT} -H 127.0.0.1`,
    url: `${BASE_URL}/api/v1/health`,
    // A reused server must have been started with the same CLAMD_* / CRON_SECRET (global-setup checks the secret).
    env: { CLAMD_HOST: '127.0.0.1', CLAMD_PORT, CRON_SECRET },
    reuseExistingServer: !CI,
    timeout: 600_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
