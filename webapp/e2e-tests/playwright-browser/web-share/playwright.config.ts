import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 3,
  reporter: 'line',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],

  webServer: [
    {
      command: 'npx wrangler dev --port 8787 --local --persist-to .wrangler/state/e2e',
      cwd: '../../../workers/share-worker',
      url: 'http://localhost:8787',
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: 'npx vite --config vite.web.config.ts --port 3002',
      cwd: '../../..',
      url: 'http://localhost:3002',
      reuseExistingServer: true,
      timeout: 15_000,
      env: {
        VITE_WORKER_URL: 'http://localhost:8787',
      },
    },
  ],
})
