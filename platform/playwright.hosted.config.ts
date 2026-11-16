import { defineConfig, devices } from '@playwright/test';

// Hosted staging checks: real browser against the deployed Worker, real Supabase staging project. Never run against production.
export default defineConfig({
  testDir: './tests/hosted',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: process.env.HOSTED_BASE_URL,
    trace: 'off',
    // Pre-launch Workers sit behind an access key (HTTP Basic, any user name).
    httpCredentials: process.env.HOSTED_ACCESS_KEY ? { username: 'inok', password: process.env.HOSTED_ACCESS_KEY } : undefined,
    extraHTTPHeaders: process.env.HOSTED_ACCESS_KEY ? { 'x-inok-access-key': process.env.HOSTED_ACCESS_KEY } : undefined,
    ...devices['Desktop Chrome'],
  },
});
