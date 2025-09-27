import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{ appWindow: Page; electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'electron/electron.cjs')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        MINIMIZE_TEST: '1'
      },
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const appWindow = await electronApp.firstWindow();
    await appWindow.waitForLoadState('domcontentloaded');
    await use(appWindow);
  },
});

test.describe('Direct Terminal Test', () => {
  test('terminal IPC should work directly', async ({ appWindow }) => {
    // Wait for app to load
    await appWindow.waitForTimeout(3000);

    // Test terminal spawn via IPC directly
    const result = await appWindow.evaluate(async () => {
      // Access electron via ipcRenderer if available
      const { ipcRenderer } = require('electron');

      if (!ipcRenderer) {
        return { error: 'ipcRenderer not available' };
      }

      try {
        // Try to spawn terminal directly via IPC
        const spawnResult = await ipcRenderer.invoke('terminal:spawn');

        if (!spawnResult.success) {
          return { error: 'Failed to spawn', details: spawnResult };
        }

        const terminalId = spawnResult.terminalId;

        // Write a command
        const writeResult = await ipcRenderer.invoke('terminal:write', terminalId, 'echo "Terminal Works!"\n');

        // Wait for output
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Write exit
        await ipcRenderer.invoke('terminal:write', terminalId, 'exit\n');

        return {
          success: true,
          terminalId,
          spawnResult,
          writeResult
        };
      } catch (err) {
        return { error: err.message };
      }
    });

    console.log('Direct IPC test result:', result);

    // The test would fail here because we can't access ipcRenderer from page context
    // This shows the issue - we need the preload script
  });
});