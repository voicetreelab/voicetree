import { test as base, expect, Page } from '@playwright/test';
import * as path from 'path';

// Create a custom test fixture with our isolated terminal setup
const test = base.extend<{
  terminalPage: Page;
}>({
  terminalPage: async ({ page }, use) => {
    // Navigate to a test harness page
    const testHarnessPath = path.resolve(process.cwd(), 'tests/e2e/isolated-xterm/test-harness.html');
    await page.goto(`file://${testHarnessPath}`);

    // Setup mock API
    await page.evaluate(() => {
      // The mock API will be loaded from the HTML file
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).testReady = true;
    });

    await use(page);
  },
});

test.describe('Isolated xterm.js Terminal Tests', () => {
  test.describe('Terminal Initialization', () => {
    test('should render terminal container', async ({ terminalPage }) => {
      const terminalContainer = await terminalPage.locator('#terminal-container');
      await expect(terminalContainer).toBeVisible();
    });

    test('should create xterm instance with correct options', async ({ terminalPage }) => {
      const terminalInfo = await terminalPage.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const term = (window as any).terminalInstance;
        return {
          exists: !!term,
          cols: term?.cols,
          rows: term?.rows,
          options: {
            cursorBlink: term?.options?.cursorBlink,
            fontSize: term?.options?.fontSize,
          }
        };
      });

      expect(terminalInfo.exists).toBe(true);
      expect(terminalInfo.cols).toBe(80);
      expect(terminalInfo.rows).toBe(24);
      expect(terminalInfo.options.cursorBlink).toBe(true);
      expect(terminalInfo.options.fontSize).toBe(14);
    });

    test('should connect to mock backend successfully', async ({ terminalPage }) => {
      const connectionStatus = await terminalPage.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockAPI = (window as any).electronAPI;
        const result = await mockAPI.terminal.spawn();
        return result;
      });

      expect(connectionStatus.success).toBe(true);
      expect(connectionStatus.terminalId).toBeTruthy();
      expect(connectionStatus.terminalId).toContain('mock-term-');
    });

    test('should display initial prompt', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100); // Wait for initial prompt

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('mock@terminal:~$');
    });
  });

  test.describe('Input/Output Operations', () => {
    test('should display typed text in terminal', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      // Type some text
      await terminalPage.keyboard.type('test input');

      // Check if text appears
      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('test input');
    });

    test('should send command on Enter key', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      // Type and execute echo command
      await terminalPage.keyboard.type('echo "Hello Terminal"');
      await terminalPage.keyboard.press('Enter');

      // Wait for response
      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('Hello Terminal');
    });

    test('should handle special characters properly', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      // Type command with special characters
      await terminalPage.keyboard.type('echo "Test@#$%^&*()"');
      await terminalPage.keyboard.press('Enter');

      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('Test@#$%^&*()');
    });

    test('should render multi-line output correctly', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      // Execute ls command which returns multi-line output
      await terminalPage.keyboard.type('ls');
      await terminalPage.keyboard.press('Enter');

      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('file1.txt');
      expect(terminalContent).toContain('file2.txt');
      expect(terminalContent).toContain('directory/');
    });
  });

  test.describe('Terminal Commands', () => {
    test('should execute echo command', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      await terminalPage.keyboard.type('echo "Test Echo"');
      await terminalPage.keyboard.press('Enter');

      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('Test Echo');
    });

    test('should execute pwd command', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      await terminalPage.keyboard.type('pwd');
      await terminalPage.keyboard.press('Enter');

      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('/home/mock/terminal');
    });

    test('should list files with ls command', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      await terminalPage.keyboard.type('ls');
      await terminalPage.keyboard.press('Enter');

      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('file1.txt');
      expect(terminalContent).toContain('file2.txt');
    });

    test('should access environment variables', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      await terminalPage.keyboard.type('echo $USER');
      await terminalPage.keyboard.press('Enter');

      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('mockuser');
    });

    test('should handle exit command', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      // Setup exit listener
      const exitPromise = terminalPage.evaluate(() => {
        return new Promise(resolve => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).electronAPI.terminal.onExit((id: string, code: number) => {
            resolve({ id, code });
          });
        });
      });

      await terminalPage.keyboard.type('exit');
      await terminalPage.keyboard.press('Enter');

      const exitResult = await exitPromise;
      expect(exitResult).toHaveProperty('code', 0);
    });
  });

  test.describe('Terminal Features', () => {
    test('should handle terminal resizing', async ({ terminalPage }) => {
      const resizeResult = await terminalPage.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const term = (window as any).terminalInstance;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockAPI = (window as any).electronAPI;
        const result = await mockAPI.terminal.spawn();

        if (result.terminalId) {
          const resizeResponse = await mockAPI.terminal.resize(result.terminalId, 100, 30);
          return {
            success: resizeResponse.success,
            cols: term.cols,
            rows: term.rows
          };
        }
        return { success: false };
      });

      expect(resizeResult.success).toBe(true);
    });

    test('should maintain scrollback buffer', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      // Execute multiple commands to fill buffer
      for (let i = 0; i < 5; i++) {
        await terminalPage.keyboard.type(`echo "Line ${i}"`);
        await terminalPage.keyboard.press('Enter');
        await terminalPage.waitForTimeout(20);
      }

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();

      // Check that all lines are present
      for (let i = 0; i < 5; i++) {
        expect(terminalContent).toContain(`Line ${i}`);
      }
    });

    test('should handle backspace key', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      // Type text and delete some
      await terminalPage.keyboard.type('test123');
      await terminalPage.keyboard.press('Backspace');
      await terminalPage.keyboard.press('Backspace');
      await terminalPage.keyboard.press('Backspace');

      await terminalPage.keyboard.press('Enter');
      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('test');
      expect(terminalContent).not.toContain('test123');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle unknown commands gracefully', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      await terminalPage.keyboard.type('unknowncommand');
      await terminalPage.keyboard.press('Enter');

      await terminalPage.waitForTimeout(50);

      const terminalContent = await terminalPage.locator('.xterm-screen').textContent();
      expect(terminalContent).toContain('command not found');
    });

    test('should handle empty commands', async ({ terminalPage }) => {
      await terminalPage.waitForTimeout(100);

      await terminalPage.locator('.xterm-screen').textContent();

      // Press Enter without typing anything
      await terminalPage.keyboard.press('Enter');
      await terminalPage.waitForTimeout(50);

      const afterContent = await terminalPage.locator('.xterm-screen').textContent();

      // Should show a new prompt
      const promptCount = (afterContent?.match(/mock@terminal:~\$/g) || []).length;
      expect(promptCount).toBeGreaterThan(1);
    });

    test('should recover from write errors', async ({ terminalPage }) => {
      const errorTest = await terminalPage.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mockAPI = (window as any).electronAPI;

        // Try to write to non-existent terminal
        const result = await mockAPI.terminal.write('invalid-id', 'test');
        return result;
      });

      expect(errorTest.success).toBe(false);
      expect(errorTest.error).toContain('not found');
    });
  });
});