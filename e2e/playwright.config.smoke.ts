import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const baseURL = process.env.E2E_BASE_URL || 'https://liive.app';

export default defineConfig({
  testDir: 'specs/',
  testMatch: /smoke\.prod\.spec\.ts$/,
  outputDir: 'specs/.test-results-smoke',
  timeout: 15 * 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report-smoke' }], ['list']],
  globalSetup: require.resolve('./setup/global-setup.smoke'),
  globalTeardown: require.resolve('./setup/global-teardown.smoke'),
  use: {
    baseURL,
    browserName: 'chromium',
    ...devices['Desktop Chrome'],
    headless: true,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: path.resolve(process.cwd(), 'e2e/storageState.smoke.json'),
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  expect: {
    timeout: 30_000,
  },
});
