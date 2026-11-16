import { defineConfig, devices } from '@playwright/test';

// Hosted staging checks: real browser against the deployed Worker, real Supabase staging project. Never run against production.
export default defineConfig({
  testDir: './tests/hosted',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: { baseURL: process.env.HOSTED_BASE_URL, trace: 'off', ...devices['Desktop Chrome'] },
});
