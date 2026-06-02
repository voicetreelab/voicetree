import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, devices} from '@playwright/test';

// Dedicated browser tier that boots REAL daemons (graphd + vtd) in globalSetup
// and proves the no-Electron keystroke round-trip through tmux. Distinct from
// playwright-ci-smoke.config.ts (no daemons): a fixed web port so globalSetup
// can set VOICETREE_CORS_ORIGINS for that exact origin before vtd boots.

const CI_CHECK_REPORTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../health-dashboard/reporters/playwright-ci-check-reporter.mjs',
);

const WEB_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e-tests/playwright-browser/daemon_integration',
  globalSetup: './e2e-tests/playwright-browser/daemon_integration/globalSetup.ts',
  globalTeardown: './e2e-tests/playwright-browser/daemon_integration/globalTeardown.ts',
  // One daemon set, one tmux server — serialize so parallel terminals can't
  // muddy the round-trip assertions.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['line'],
    [CI_CHECK_REPORTER, {
      checkId: 'e2e-browser-daemon',
      checkName: 'E2E Browser Daemon Round-Trip',
      command: 'playwright test --config=playwright-browser-daemon.config.ts',
    }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome'], headless: true},
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 30_000,
    env: {
      VITE_DISABLE_ANALYTICS: 'true',
      VT_DISABLE_DEV_SERVER_WATCH: '1',
    },
  },
});
