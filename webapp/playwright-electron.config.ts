import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

/**
 * Tier 3 Playwright configuration for Electron subsystem verification tests.
 *
 * Tests the Electron application with real file system operations and the
 * complete IPC pipeline. Two critical specs are promoted to tier 2 and
 * `testIgnore`'d here so they don't run twice — see
 * `playwright-tier2-electron-critical.config.ts`.
 */
const TIER2_PROMOTED_SPECS = [
  '**/electron-editor-disk-convergence.spec.ts',
  '**/electron-project-selection.spec.ts',
];

export default defineConfig({
  testDir: './e2e-tests/electron/critical_e2e_verification_tests',
  testMatch: '**/electron-*.spec.ts', // Only run electron-specific e2e-tests
  testIgnore: TIER2_PROMOTED_SPECS,
  fullyParallel: false, // Run e2e-tests sequentially for Electron
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Electron tests require serial execution - parallel tests cause fixture teardown timeouts, todo, invesitgate this at some point Serial execution (workers=1) should not be required - Electron tests can share resources and succeed with parallelism if done correctly
  // Suppress noisy internal warnings
  quiet: process.env.PLAYWRIGHT_QUIET !== 'false',
  reporter: [
    ['list', { printSteps: false }], // Suppress internal step errors
    ['html', { outputFolder: 'playwright-report-electron', open: 'never' }],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-tier2-electron',
      checkName: 'E2E Tier 2 (Electron)',
      command: 'npm run test:e2e:tier2:electron',
    }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  // Longer timeout for Electron app startup — CI runners are slower
  timeout: process.env.CI ? 90000 : 30000,

  projects: [
    {
      name: 'electron',
      testMatch: '**/electron-*.spec.ts',
      testIgnore: TIER2_PROMOTED_SPECS,
    }
  ],

  // No web server needed for Electron e2e-tests
});
