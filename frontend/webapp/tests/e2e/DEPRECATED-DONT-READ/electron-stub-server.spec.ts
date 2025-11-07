import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow extends Window {
  electronAPI?: {
    getBackendPort: () => Promise<number>;
  };
}

const test = base.extend<{
  electronApp: ElectronApplication;
  appWindow: Page;
}>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        USE_VOICETREE_STUB_SERVER: '1',
        MINIMIZE_TEST: '1'
      }
    });
    await use(electronApp);
    await electronApp.close();
  },
  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await use(window);
  }
});

test.describe('Stub Server Test', () => {
  test('should start and respond to health check', async ({ appWindow }) => {
    await appWindow.waitForLoadState('domcontentloaded');

    const port = await appWindow.evaluate(async () => {
      const api = (window as ExtendedWindow).electronAPI;
      if (!api) throw new Error('electronAPI not available');
      return await api.getBackendPort();
    });

    expect(port).toBeGreaterThan(0);

    const response = await appWindow.evaluate(async (port) => {
      const res = await fetch(`http://localhost:${port}/health`);
      return await res.json();
    }, port);

    expect(response.status).toBe('ok');
    expect(response.message).toBe('Stub backend healthy');
  });
});
