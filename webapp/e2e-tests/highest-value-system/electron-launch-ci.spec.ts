import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WEBAPP_ROOT } from './electron-smoke-helpers';

test.describe('Electron CI Launch Fallback', () => {
  test('starts Electron and renders the project selection window', async () => {
    test.setTimeout(process.env.CI ? 45000 : 30000);

    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-launch-ci-'));
    let electronApp: ElectronApplication | undefined;
    let appWindow: Page | undefined;

    try {
      await fs.writeFile(
        path.join(tempUserDataPath, 'projects.json'),
        JSON.stringify([], null, 2),
        'utf8'
      );

      const ciFlags = process.env.CI
        ? ['--no-sandbox', '--disable-dev-shm-usage']
        : [];

      electronApp = await electron.launch({
        args: [
          ...ciFlags,
          path.join(WEBAPP_ROOT, 'dist-electron/main/index.js'),
          `--user-data-dir=${tempUserDataPath}`
        ],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          HEADLESS_TEST: '1',
          MINIMIZE_TEST: '1'
        },
        timeout: 30000
      });

      appWindow = await electronApp.firstWindow({ timeout: 15000 });
      appWindow.on('console', msg => {
        console.log(`BROWSER [${msg.type()}]:`, msg.text());
      });
      appWindow.on('pageerror', error => {
        console.error('PAGE ERROR:', error.message);
      });

      await appWindow.waitForLoadState('domcontentloaded');
      await expect(appWindow.locator('body')).toContainText(/Voicetree|Select a project|No projects yet/, {
        timeout: 15000
      });

      const title = await appWindow.title();
      const bodyText = await appWindow.locator('body').innerText();
      expect(`${title}\n${bodyText}`).toMatch(/Voicetree|Select a project|No projects yet/);
    } finally {
      if (electronApp) {
        await electronApp.close();
      }
      await fs.rm(tempUserDataPath, { recursive: true, force: true });
    }
  });
});
