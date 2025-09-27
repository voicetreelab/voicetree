import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Electron E2E tests
 * This configuration is specifically for testing the Electron application
 * with real file system operations and the complete IPC pipeline.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/electron-*.spec.ts', // Only run electron-specific tests
  fullyParallel: false, // Run tests sequentially for Electron
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker for Electron tests
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-electron', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  // Longer timeout for Electron app startup
  timeout: 60000,

  projects: [
    {
      name: 'electron',
      testMatch: '**/electron-*.spec.ts',
    }
  ],

  // No web server needed for Electron tests
});