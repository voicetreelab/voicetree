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

test.describe('Terminal - PWD Command Test', () => {
  test('should execute pwd command and display current directory', async ({ appWindow }) => {
    // Wait for app to load
    await appWindow.waitForTimeout(3000);

    // Test terminal with pwd command
    const terminalTest = await appWindow.evaluate(async () => {
      // Check if electron API is available
      if (!window.electronAPI?.terminal) {
        return { success: false, error: 'Terminal API not available' };
      }

      // Spawn a terminal
      const spawnResult = await window.electronAPI.terminal.spawn();

      if (!spawnResult.success || !spawnResult.terminalId) {
        return {
          success: false,
          error: 'Failed to spawn terminal',
          spawnError: spawnResult.error
        };
      }

      const terminalId = spawnResult.terminalId;
      let outputBuffer: string[] = [];
      let pwdResult = '';

      // Set up data listener to capture output
      window.electronAPI.terminal.onData((id, data) => {
        if (id === terminalId) {
          outputBuffer.push(data);
          console.log('Terminal output:', data);
        }
      });

      // Execute pwd command
      console.log('Executing pwd command...');
      await window.electronAPI.terminal.write(terminalId, 'pwd\n');

      // Wait for output
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Collect output
      pwdResult = outputBuffer.join('');

      // Clean up
      await window.electronAPI.terminal.kill(terminalId);

      return {
        success: true,
        output: pwdResult,
        terminalId: terminalId
      };
    });

    console.log('Terminal test result:', terminalTest);

    // Verify test succeeded
    expect(terminalTest.success).toBe(true);

    // Verify output contains a valid path
    expect(terminalTest.output).toBeTruthy();
    expect(terminalTest.output).toMatch(/\//); // Should contain at least one slash

    // Extract the actual pwd path from output
    const lines = terminalTest.output.split('\n').filter((line: string) => line.trim());
    const pwdLine = lines.find((line: string) => line.startsWith('/'));

    expect(pwdLine).toBeTruthy();
    expect(pwdLine).toMatch(/^\/[\w\-\/\.]+/); // Basic path validation
  });

  test('should execute multiple commands including pwd', async ({ appWindow }) => {
    // Wait for app to load
    await appWindow.waitForTimeout(3000);

    const terminalTest = await appWindow.evaluate(async () => {
      if (!window.electronAPI?.terminal) {
        return { success: false, error: 'Terminal API not available' };
      }

      const spawnResult = await window.electronAPI.terminal.spawn();

      if (!spawnResult.success || !spawnResult.terminalId) {
        return {
          success: false,
          error: 'Failed to spawn terminal',
          spawnError: spawnResult.error
        };
      }

      const terminalId = spawnResult.terminalId;
      let outputBuffer: string[] = [];
      const commands: { command: string; output: string }[] = [];

      // Set up data listener
      window.electronAPI.terminal.onData((id, data) => {
        if (id === terminalId) {
          outputBuffer.push(data);
        }
      });

      // Execute pwd
      await window.electronAPI.terminal.write(terminalId, 'pwd\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
      commands.push({ command: 'pwd', output: outputBuffer.join('') });

      // Clear buffer for next command
      outputBuffer = [];

      // Execute echo
      await window.electronAPI.terminal.write(terminalId, 'echo "Hello from test"\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
      commands.push({ command: 'echo', output: outputBuffer.join('') });

      // Clear buffer
      outputBuffer = [];

      // Execute ls
      await window.electronAPI.terminal.write(terminalId, 'ls\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
      commands.push({ command: 'ls', output: outputBuffer.join('') });

      // Clean up
      await window.electronAPI.terminal.kill(terminalId);

      return {
        success: true,
        commands: commands
      };
    });

    console.log('Multiple commands test result:', terminalTest);

    // Verify test succeeded
    expect(terminalTest.success).toBe(true);

    // Verify pwd command output
    const pwdCommand = terminalTest.commands.find((cmd: any) => cmd.command === 'pwd');
    expect(pwdCommand).toBeTruthy();
    expect(pwdCommand.output).toMatch(/\//);

    // Verify echo command output
    const echoCommand = terminalTest.commands.find((cmd: any) => cmd.command === 'echo');
    expect(echoCommand).toBeTruthy();
    expect(echoCommand.output).toContain('Hello from test');

    // Verify ls command output
    const lsCommand = terminalTest.commands.find((cmd: any) => cmd.command === 'ls');
    expect(lsCommand).toBeTruthy();
    expect(lsCommand.output.length).toBeGreaterThan(0);
  });

  test('should handle pwd in different directories', async ({ appWindow }) => {
    // Wait for app to load
    await appWindow.waitForTimeout(3000);

    const terminalTest = await appWindow.evaluate(async () => {
      if (!window.electronAPI?.terminal) {
        return { success: false, error: 'Terminal API not available' };
      }

      const spawnResult = await window.electronAPI.terminal.spawn();

      if (!spawnResult.success || !spawnResult.terminalId) {
        return {
          success: false,
          error: 'Failed to spawn terminal',
          spawnError: spawnResult.error
        };
      }

      const terminalId = spawnResult.terminalId;
      let outputBuffer: string[] = [];
      const directories: { dir: string; pwd: string }[] = [];

      // Set up data listener
      window.electronAPI.terminal.onData((id, data) => {
        if (id === terminalId) {
          outputBuffer.push(data);
        }
      });

      // Get initial pwd
      await window.electronAPI.terminal.write(terminalId, 'pwd\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const initialPwd = outputBuffer.join('');
      directories.push({ dir: 'initial', pwd: initialPwd });

      // Clear buffer
      outputBuffer = [];

      // Change to /tmp and get pwd
      await window.electronAPI.terminal.write(terminalId, 'cd /tmp\n');
      await new Promise(resolve => setTimeout(resolve, 500));

      outputBuffer = [];
      await window.electronAPI.terminal.write(terminalId, 'pwd\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const tmpPwd = outputBuffer.join('');
      directories.push({ dir: '/tmp', pwd: tmpPwd });

      // Clean up
      await window.electronAPI.terminal.kill(terminalId);

      return {
        success: true,
        directories: directories
      };
    });

    console.log('Directory navigation test result:', terminalTest);

    // Verify test succeeded
    expect(terminalTest.success).toBe(true);

    // Verify we got different directories
    expect(terminalTest.directories.length).toBe(2);

    // Verify /tmp pwd output
    const tmpDir = terminalTest.directories.find((d: any) => d.dir === '/tmp');
    expect(tmpDir).toBeTruthy();
    expect(tmpDir.pwd).toContain('/tmp');
  });
});