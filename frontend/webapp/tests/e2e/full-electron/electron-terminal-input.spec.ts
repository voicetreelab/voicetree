import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Use absolute path from project root
const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow extends Window {
  cytoscapeInstance?: any;
  electronAPI?: {
    startFileWatching: (dir: string) => Promise<{ success: boolean; directory?: string; error?: string }>;
    terminal: {
      spawn: () => Promise<{ success: boolean; terminalId?: string; error?: string }>;
      write: (terminalId: string, data: string) => Promise<{ success: boolean; error?: string }>;
      resize: (terminalId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
      kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>;
      onData: (callback: (terminalId: string, data: string) => void) => void;
      onExit: (callback: (terminalId: string, code: number) => void) => void;
    };
  };
}

// Custom test fixture that provides tempDir
const test = base.extend<{ tempDir: string; appWindow: Page; electronApp: ElectronApplication }>({
  tempDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-input-test-'));
    await use(tempDir);
    await fs.rm(tempDir, { recursive: true, force: true });
  },

  electronApp: async ({}, use) => {
    // Launch Electron app with test environment
    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'electron/electron.cjs'),
      ],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TEST_MODE: '1'
      },
    });
    await use(electronApp);
    await electronApp.close();
  },

  appWindow: async ({ electronApp }, use) => {
    const appWindow = await electronApp.firstWindow();
    await appWindow.waitForLoadState('domcontentloaded');

    // Wait for the app to be ready
    await expect.poll(async () => {
      return appWindow.evaluate(() => document.readyState === 'complete');
    }).toBe(true);

    await use(appWindow);
  },
});

test.describe('Terminal Input Tests', () => {
  test.beforeEach(async ({ tempDir }) => {
    // Create test markdown files
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nThis is a test node for terminal input testing.`
    );
  });

  test('terminal should accept keyboard input', async ({ appWindow, tempDir }) => {
    console.log('Starting terminal input test...');

    // Wait for app to load
    await appWindow.waitForLoadState('domcontentloaded');
    await appWindow.waitForTimeout(2000);

    // Start file watching using the correct API
    const startResult = await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI?.startFileWatching) {
        return await window.electronAPI.startFileWatching(dir);
      }
      return { success: false, error: 'API not available' };
    }, tempDir);

    console.log('File watching start result:', startResult);

    // Wait for cytoscape to be available
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        return window.cytoscapeInstance !== undefined;
      });
    }, { timeout: 10000 }).toBe(true);

    // Wait a bit for initial load
    await appWindow.waitForTimeout(2000);

    // Find and right-click on the first node to get context menu
    const node = await appWindow.locator('.cy-node').first();
    await node.click({ button: 'right' });

    // Wait for context menu to appear
    await appWindow.waitForTimeout(500);

    // Find and click the Terminal option
    const terminalOption = await appWindow.locator('text=Terminal').first();
    await expect(terminalOption).toBeVisible({ timeout: 5000 });
    await terminalOption.click();

    // Wait for terminal window to appear
    const terminalWindow = await appWindow.locator('.floating-window').filter({ has: appWindow.locator('text=Terminal') });
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });

    // Find the terminal content area (xterm element)
    const terminalContent = await terminalWindow.locator('.xterm').first();
    await expect(terminalContent).toBeVisible({ timeout: 5000 });

    // Click on terminal to focus it
    await terminalContent.click();
    await appWindow.waitForTimeout(1000);

    // Type a simple command
    console.log('Typing "echo test" in terminal...');
    await appWindow.keyboard.type('echo test');
    await appWindow.waitForTimeout(500);

    // Press Enter
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    // Check if the command was executed and output appears
    const terminalOutput = await terminalContent.textContent();
    console.log('Terminal output:', terminalOutput);

    // The terminal should show both the command and its output
    expect(terminalOutput).toContain('echo test');
    expect(terminalOutput).toContain('test');
  });

  test('terminal should handle special keys', async ({ appWindow, tempDir }) => {
    console.log('Starting special keys test...');

    // Start file watching
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI?.fileWatcher) {
        await window.electronAPI.fileWatcher.start(dir);
      }
    }, tempDir);

    // Wait for cytoscape to be available
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        return window.cytoscapeInstance !== undefined;
      });
    }).toBe(true);

    // Wait a bit for initial load
    await appWindow.waitForTimeout(2000);

    // Find and right-click on the first node to get context menu
    const node = await appWindow.locator('.cy-node').first();
    await node.click({ button: 'right' });

    // Wait for context menu to appear
    await appWindow.waitForTimeout(500);

    // Find and click the Terminal option
    const terminalOption = await appWindow.locator('text=Terminal').first();
    await expect(terminalOption).toBeVisible({ timeout: 5000 });
    await terminalOption.click();

    // Wait for terminal window to appear
    const terminalWindow = await appWindow.locator('.floating-window').filter({ has: appWindow.locator('text=Terminal') });
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });

    // Find the terminal content area
    const terminalContent = await terminalWindow.locator('.xterm').first();
    await expect(terminalContent).toBeVisible({ timeout: 5000 });

    // Click on terminal to focus it
    await terminalContent.click();
    await appWindow.waitForTimeout(1000);

    // Type some text
    console.log('Typing "hello world"...');
    await appWindow.keyboard.type('hello world');
    await appWindow.waitForTimeout(500);

    // Test backspace
    console.log('Testing backspace...');
    await appWindow.keyboard.press('Backspace');
    await appWindow.keyboard.press('Backspace');
    await appWindow.keyboard.press('Backspace');
    await appWindow.keyboard.press('Backspace');
    await appWindow.keyboard.press('Backspace');
    await appWindow.waitForTimeout(500);

    // Type replacement text
    await appWindow.keyboard.type('test');
    await appWindow.waitForTimeout(500);

    // Press Enter
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    // Check the terminal shows the corrected command
    const terminalOutput = await terminalContent.textContent();
    console.log('Terminal output after backspace test:', terminalOutput);

    expect(terminalOutput).toContain('hello test');
  });
});