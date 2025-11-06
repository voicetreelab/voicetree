import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());

const test = base.extend<{ appWindow: Page; electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'electron/electron-pty.cjs'), // Use the PTY version
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_MODE: '1'
      },
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const appWindow = await electronApp.firstWindow();
    await appWindow.waitForLoadState('domcontentloaded');

    // Wait for app to be ready
    await expect.poll(async () => {
      return appWindow.evaluate(() => document.readyState === 'complete');
    }).toBe(true);

    await use(appWindow);
  },
});

test.describe('Real PTY Terminal Tests', () => {
  test('should execute pwd command and return real absolutePath', async ({ appWindow }) => {
    // Wait for app to initialize
    await appWindow.waitForTimeout(2000);

    // Test terminal API directly
    const terminalTest = await appWindow.evaluate(async () => {
      const apiInfo = {
        hasWindow: typeof window !== 'undefined',
        hasElectronAPI: typeof window.electronAPI !== 'undefined',
        hasTerminal: window.electronAPI?.terminal !== undefined
      };

      console.log('API Info:', apiInfo);

      if (!window.electronAPI?.terminal) {
        return { success: false, error: 'Terminal API not available', apiInfo };
      }

      // Spawn a terminal
      const spawnResult = await window.electronAPI.terminal.spawn();
      if (!spawnResult.success) {
        return { success: false, error: 'Failed to spawn terminal', details: spawnResult };
      }

      const terminalId = spawnResult.terminalId;

      // Collect output
      let outputData = '';
      let pwdOutput = '';
      let gotPwd = false;

      // Set up data handler with promise for pwd output
      const pwdPromise = new Promise<string>((resolve) => {
        window.electronAPI.terminal.onData((id, data) => {
          if (id === terminalId) {
            outputData += data;
            console.log('Received data:', data);

            // Look for absolutePath in output (after pwd command)
            if (outputData.includes('pwd') && !gotPwd) {
              // Extract the absolutePath from the output
              const lines = outputData.split(/\r?\n/);
              for (const line of lines) {
                // Skip prompt lines and the pwd command itself
                if (line && !line.includes('$') && !line.includes('pwd') && line.trim() !== '') {
                  if (line.startsWith('/') || line.includes(':\\')) { // Unix or Windows absolutePath
                    pwdOutput = line.trim();
                    gotPwd = true;
                    resolve(pwdOutput);
                    break;
                  }
                }
              }
            }
          }
        });

        // Timeout after 3 seconds
        setTimeout(() => resolve('TIMEOUT'), 3000);
      });

      // Wait a bit for terminal to initialize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Execute pwd command
      const writeResult = await window.electronAPI.terminal.write(terminalId, 'pwd\n');
      if (!writeResult.success) {
        return { success: false, error: 'Failed to write pwd command', details: writeResult };
      }

      // Wait for pwd output
      const result = await pwdPromise;

      // Clean up terminal
      await window.electronAPI.terminal.kill(terminalId);

      return {
        success: true,
        terminalId,
        pwdOutput: result,
        outputReceived: outputData.length > 0,
        fullOutput: outputData.substring(0, 500) // First 500 chars for debugging
      };
    });

    console.log('Terminal test result:', terminalTest);

    // Verify results
    expect(terminalTest.success).toBe(true);
    expect(terminalTest.outputReceived).toBe(true);
    expect(terminalTest.pwdOutput).not.toBe('TIMEOUT');

    // Verify we got a real absolutePath
    expect(terminalTest.pwdOutput).toBeTruthy();
    expect(terminalTest.pwdOutput).toMatch(/^(\/|[A-Z]:\\)/); // Unix absolutePath or Windows absolutePath
  });

  test('should execute ls command and show files', async ({ appWindow }) => {
    await appWindow.waitForTimeout(2000);

    const terminalTest = await appWindow.evaluate(async () => {
      if (!window.electronAPI?.terminal) {
        return { success: false, error: 'Terminal API not available' };
      }

      const spawnResult = await window.electronAPI.terminal.spawn();
      if (!spawnResult.success) {
        return { success: false, error: 'Failed to spawn terminal' };
      }

      const terminalId = spawnResult.terminalId;
      let outputData = '';

      const lsPromise = new Promise<string>((resolve) => {
        window.electronAPI.terminal.onData((id, data) => {
          if (id === terminalId) {
            outputData += data;

            // Look for common files/directories after ls
            if (outputData.includes('ls') &&
                (outputData.includes('.') ||
                 outputData.includes('node_modules') ||
                 outputData.includes('package.json'))) {
              setTimeout(() => resolve(outputData), 500); // Wait a bit more for full output
            }
          }
        });

        setTimeout(() => resolve(outputData), 3000);
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Execute ls command
      await window.electronAPI.terminal.write(terminalId, 'ls\n');

      const result = await lsPromise;
      await window.electronAPI.terminal.kill(terminalId);

      return {
        success: true,
        output: result,
        hasOutput: result.length > 0,
        containsFiles: result.includes('.') || result.includes('node_modules')
      };
    });

    expect(terminalTest.success).toBe(true);
    expect(terminalTest.hasOutput).toBe(true);
    expect(terminalTest.containsFiles).toBe(true);
  });

  test('should handle echo command with real output', async ({ appWindow }) => {
    await appWindow.waitForTimeout(2000);

    const terminalTest = await appWindow.evaluate(async () => {
      if (!window.electronAPI?.terminal) {
        return { success: false, error: 'Terminal API not available' };
      }

      const spawnResult = await window.electronAPI.terminal.spawn();
      if (!spawnResult.success) {
        return { success: false, error: 'Failed to spawn terminal' };
      }

      const terminalId = spawnResult.terminalId;
      const testMessage = 'Hello from real PTY terminal!';
      let outputData = '';

      const echoPromise = new Promise<boolean>((resolve) => {
        window.electronAPI.terminal.onData((id, data) => {
          if (id === terminalId) {
            outputData += data;
            if (outputData.includes(testMessage)) {
              resolve(true);
            }
          }
        });

        setTimeout(() => resolve(false), 3000);
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Execute echo command
      await window.electronAPI.terminal.write(terminalId, `echo "${testMessage}"\n`);

      const found = await echoPromise;
      await window.electronAPI.terminal.kill(terminalId);

      return {
        success: true,
        foundMessage: found,
        output: outputData
      };
    });

    expect(terminalTest.success).toBe(true);
    expect(terminalTest.foundMessage).toBe(true);
    expect(terminalTest.output).toContain('Hello from real PTY terminal!');
  });
});