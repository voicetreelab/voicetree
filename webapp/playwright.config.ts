import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

const browserTestPort = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const browserTestBaseURL = `http://127.0.0.1:${browserTestPort}`;

export default defineConfig({
  // Tier 2: curated browser subsystem verification.
  testDir: './e2e-tests/playwright-browser/critical_for_verification',
  testIgnore: '**/daemon_integration/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 5, // Limit to 5 workers locally to prevent CPU overload
  reporter: [
    ['line'],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-tier2-browser',
      checkName: 'E2E Tier 2 (Browser)',
      command: 'npm run test:e2e:tier2:browser',
    }],
  ],
  use: {
    baseURL: browserTestBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        headless: true,
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     headless: true,
    //   },
    // },
    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     headless: true,
    //   },
    // },
  ],

  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${browserTestPort} --strictPort`,
    url: browserTestBaseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 12 * 1000,
    env: {
      VITE_DISABLE_ANALYTICS: 'true',
    },
  },
});
