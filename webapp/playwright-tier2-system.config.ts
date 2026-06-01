import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

/**
 * Tier 2: focused Electron project-switch regression coverage.
 *
 * This covers the initialLoad() + startFileWatching() path that Tier 1 cannot
 * cover because Tier 1 starts Electron with --open-folder.
 */
export default defineConfig({
  testDir: './e2e-tests/highest-value-system',
  testMatch: 'electron-project-switch.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  quiet: process.env.PLAYWRIGHT_QUIET !== 'false',
  reporter: [
    ['list', { printSteps: false }],
    ['html', { outputFolder: 'playwright-report-tier2-system', open: 'never' }],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-tier2',
      checkName: 'E2E Tier 2 (Electron Project Switch)',
      command: 'npm run test:e2e:tier2',
    }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: process.env.CI ? 60000 : 30000,
  projects: [
    {
      name: 'electron-project-switch',
      testMatch: 'electron-project-switch.spec.ts',
    },
  ],
});
