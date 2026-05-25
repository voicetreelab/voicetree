import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

/**
 * Tier 2 (critical) Playwright configuration for Electron.
 *
 * Narrowed to the two specs we want gating every PR:
 *   - electron-editor-disk-convergence.spec.ts   (editor ↔ graph ↔ disk)
 *   - electron-project-selection.spec.ts         (launch + scanner)
 *
 * Sibling config `playwright-electron.config.ts` runs the remaining critical
 * electron specs at tier 3 (with these two `testIgnore`'d to avoid double-run).
 */
const CRITICAL_TIER2_SPECS = [
  'electron-editor-disk-convergence.spec.ts',
  'electron-project-selection.spec.ts',
];

export default defineConfig({
  testDir: './e2e-tests/electron/critical_e2e_verification_tests',
  testMatch: CRITICAL_TIER2_SPECS,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  quiet: process.env.PLAYWRIGHT_QUIET !== 'false',
  reporter: [
    ['list', { printSteps: false }],
    ['html', { outputFolder: 'playwright-report-tier2-electron-critical', open: 'never' }],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-tier2-electron-critical',
      checkName: 'E2E Tier 2 (Electron Critical)',
      command: 'npm run test:e2e:tier2:electron-critical',
    }],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: process.env.CI ? 90000 : 30000,
  projects: [
    {
      name: 'electron',
      testMatch: CRITICAL_TIER2_SPECS,
    },
  ],
});
