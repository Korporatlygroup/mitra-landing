import { defineConfig, devices } from '@playwright/test';

// Production acceptance run: real browsers against app.inok.my (still behind the access gate) with SYNTHETIC accounts only
// (example.test addresses, no email is ever sent to them). One worker, no retries, no load. Never run without ALLOW_PRODUCTION_TESTS.
export default defineConfig({
  testDir: './tests/production',
  testMatch: /.*\.spec\.ts$/,
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/production/pw',
  use: {
    baseURL: process.env.HOSTED_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: process.env.HOSTED_ACCESS_KEY ? { 'x-inok-access-key': process.env.HOSTED_ACCESS_KEY } : undefined,
    ...devices['Desktop Chrome'],
  },
});
