import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Electron E2E e2e-tests
 * This configuration is specifically for testing the Electron application
 * with real file system operations and the complete IPC pipeline.
 */
export default defineConfig({
  testDir: './e2e-tests/electron/critical_e2e_verification_tests',
  testMatch: '**/electron-*.spec.ts', // Only run electron-specific e2e-tests
  fullyParallel: false, // Run e2e-tests sequentially for Electron
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Electron tests require serial execution - parallel tests cause fixture teardown timeouts, todo, invesitgate this at some point Serial execution (workers=1) should not be required - Electron tests can share resources and succeed with parallelism if done correctly
  // Suppress noisy internal warnings
  quiet: process.env.PLAYWRIGHT_QUIET !== 'false',
  reporter: [
    ['list', { printSteps: false }], // Suppress internal step errors
    ['html', { outputFolder: 'playwright-report-electron', open: 'never' }]
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  // Longer timeout for Electron app startup
  timeout: 30000,

  projects: [
    {
      name: 'electron',
      testMatch: '**/electron-*.spec.ts',
    }
  ],

  // No web server needed for Electron e2e-tests
});