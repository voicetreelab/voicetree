import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{ appWindow: Page; electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'electron/electron.cjs')],
      env: {
        ...process.env,
        NODE_ENV: 'development'
        // Don't use MINIMIZE_TEST to load dev server instead of built files
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

test.describe('Terminal Basic Functionality', () => {
  test('terminal spawn and input should work', async ({ appWindow }) => {
    // Wait for app to load
    await appWindow.waitForTimeout(3000);

    // Test terminal API directly through console
    const terminalTest = await appWindow.evaluate(async () => {
      // Debug what's available
      const apiInfo = {
        hasWindow: typeof window !== 'undefined',
        hasElectronAPI: typeof window.electronAPI !== 'undefined',
        electronAPIKeys: window.electronAPI ? Object.keys(window.electronAPI) : [],
        hasTerminal: window.electronAPI?.terminal !== undefined
      };

      console.log('API Info:', apiInfo);

      // Check if electron API is available
      if (!window.electronAPI?.terminal) {
        return { success: false, error: 'Terminal API not available', apiInfo };
      }

      // Spawn a terminal
      const spawnResult = await window.electronAPI.terminal.spawn();
      if (!spawnResult.success) {
        return { success: false, error: 'Failed to spawn terminal', details: spawnResult };
      }

      const terminalId = spawnResult.terminalId;

      // Set up data collection
      let outputData = '';
      window.electronAPI.terminal.onData((id, data) => {
        if (id === terminalId) {
          outputData += data;
        }
      });

      // Write a simple echo command
      const writeResult = await window.electronAPI.terminal.write(terminalId, 'echo "Hello from terminal"\n');
      if (!writeResult.success) {
        return { success: false, error: 'Failed to write to terminal', details: writeResult };
      }

      // Wait a bit for output
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Write exit command
      await window.electronAPI.terminal.write(terminalId, 'exit\n');

      // Wait for terminal to process
      await new Promise(resolve => setTimeout(resolve, 500));

      return {
        success: true,
        terminalId,
        outputReceived: outputData.length > 0,
        outputContainsEcho: outputData.includes('Hello from terminal'),
        outputSample: outputData.substring(0, 200)
      };
    });

    console.log('Terminal test result:', terminalTest);

    // Verify terminal worked
    expect(terminalTest.success).toBe(true);
    expect(terminalTest.outputReceived).toBe(true);
    expect(terminalTest.outputContainsEcho).toBe(true);
  });
});