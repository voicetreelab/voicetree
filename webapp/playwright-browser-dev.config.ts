import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-tests/playwright-browser/for_feature_development_skip',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3000',
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
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            // Required for SSE streaming from VTD/graphd when daemons predate native CORS support.
            // Playwright's route.fetch() buffers streaming responses, deadlocking SSE connections.
            // With --disable-web-security the browser accepts SSE from old daemons without
            // Access-Control-Allow-Origin. CORS correctness is unit-tested in corsHeaders.test.ts.
            '--disable-web-security',
          ],
        },
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 12 * 1000,
    env: {
      VITE_DISABLE_ANALYTICS: 'true',
    },
  },
});
