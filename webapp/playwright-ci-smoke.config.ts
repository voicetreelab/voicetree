import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

const browserSmokePort = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const browserSmokeBaseURL = `http://127.0.0.1:${browserSmokePort}`;
const browserSmokeServerCommand = `npm run dev -- --host 127.0.0.1 --port ${browserSmokePort} --strictPort`;

export default defineConfig({
  testDir: './e2e-tests/playwright-browser/critical_for_verification',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 5,
  reporter: [
    ['line'],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-browser-smoke',
      checkName: 'E2E Browser Smoke',
      command: 'playwright test --config=playwright-ci-smoke.config.ts',
    }],
  ],
  use: {
    baseURL: browserSmokeBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
  webServer: {
    command: browserSmokeServerCommand,
    url: browserSmokeBaseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 30_000,
    env: {
      VITE_DISABLE_ANALYTICS: 'true',
      VT_DISABLE_DEV_SERVER_WATCH: '1',
    },
  },
});
