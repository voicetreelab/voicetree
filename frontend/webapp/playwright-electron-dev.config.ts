import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Electron E2E feature development tests
 * These tests are for feature development and are not run in CI/verification.
 */
export default defineConfig({
  testDir: './e2e-tests/electron/for_feature_development_not_LT_verification',
  testMatch: '**/electron-*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  quiet: process.env.PLAYWRIGHT_QUIET !== 'false',
  reporter: [
    ['list', { printSteps: false }],
    ['html', { outputFolder: 'playwright-report-electron-dev', open: 'never' }]
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  timeout: 90000,
  projects: [
    {
      name: 'electron',
      testMatch: '**/electron-*.spec.ts',
    }
  ],
});
