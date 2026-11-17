import { defineConfig, devices } from '@playwright/test';

// Multi-agent user-journey suite: real browsers against the deployed staging Worker and the real mitra-staging project. One runner,
// one worker, no retries (a retry would hide the Worker's CPU-limit failures; the harness logs every 5xx separately). Never run against production.
export default defineConfig({
  testDir: './tests/agents',
  testMatch: /.*\.spec\.ts$/,
  timeout: 600_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/agents/pw',
  use: {
    baseURL: process.env.HOSTED_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    httpCredentials: process.env.HOSTED_ACCESS_KEY ? { username: 'inok', password: process.env.HOSTED_ACCESS_KEY } : undefined,
    extraHTTPHeaders: process.env.HOSTED_ACCESS_KEY ? { 'x-inok-access-key': process.env.HOSTED_ACCESS_KEY } : undefined,
    ...devices['Desktop Chrome'],
  },
});
