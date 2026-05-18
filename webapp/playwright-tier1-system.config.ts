import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

/**
 * Tier 1: the single highest-value system test.
 *
 * Keep this gate intentionally narrow. Broader subsystem verification belongs in
 * the Tier 2 configs; feature-development tests must not be wired to npm scripts.
 */
export default defineConfig({
  testDir: './e2e-tests/highest-value-system',
  testMatch: 'electron-{smoke-test,launch-ci}.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  quiet: process.env.PLAYWRIGHT_QUIET !== 'false',
  reporter: [
    ['list', { printSteps: false }],
    ['html', { outputFolder: 'playwright-report-tier1-system', open: 'never' }],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-tier1',
      checkName: 'E2E Tier 1 (Electron Smoke)',
      command: 'npm run test:e2e:tier1',
    }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  timeout: process.env.CI ? 60000 : 30000,
  projects: [
    {
      name: 'electron-system-smoke',
      testMatch: 'electron-{smoke-test,launch-ci}.spec.ts',
    }
  ],
});
