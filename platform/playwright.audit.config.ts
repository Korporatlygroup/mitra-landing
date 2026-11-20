import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/audit', testMatch: /.*\.spec\.ts$/, fullyParallel: false, workers: 1, timeout: 3_000_000, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3000', actionTimeout: 20_000, navigationTimeout: 60_000, locale: 'en-US' },
  projects: [{ name: 'audit', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } }] });
