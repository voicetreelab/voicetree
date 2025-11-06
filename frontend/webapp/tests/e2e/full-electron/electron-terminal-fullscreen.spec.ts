/**
 * BEHAVIORAL SPEC:
 * 1. Terminals have a fullscreen button in the title bar
 * 2. Clicking the fullscreen button enters fullscreen mode
 * 3. Terminal fits properly in fullscreen mode
 * 4. Clicking the fullscreen button again exits fullscreen mode
 * 5. Terminal returns to normal size after exiting fullscreen
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { focusTerminal, getTerminalContent } from './test-utils';

// Use absolute absolutePath from project root
const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow extends Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cytoscapeInstance?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  electronAPI?: any;
}

// Custom test fixture that provides tempDir
const test = base.extend<{ tempDir: string; appWindow: Page; electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    // Launch Electron app with test environment
    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_MODE: '1',
        HEADLESS_TEST: '0', // Show window for fullscreen test
        MINIMIZE_TEST: '0'
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

  tempDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-fullscreen-test-'));
    await use(tempDir);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  },
});

test.describe('Terminal Fullscreen Tests', () => {
  test('should have fullscreen button and toggle fullscreen mode with before/after screenshots', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan to complete
    await appWindow.waitForTimeout(2000);

    // Create test markdown file AFTER watching starts
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nThis is a test node for terminal fullscreen testing.`
    );

    // Wait for graph to load
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        const cy = window.cytoscapeInstance;
        return cy && cy.nodes().length > 0;
      });
    }, {
      message: 'Waiting for graph nodes to load',
      timeout: 10000
    }).toBe(true);

    // Open terminal using test helper
    await appWindow.evaluate(() => {
      const window = globalThis as ExtendedWindow;
      const testHelpers = (window as unknown as { testHelpers?: { createTerminal: (nodeId: string) => void } }).testHelpers;
      const cy = window.cytoscapeInstance;

      if (testHelpers && cy && cy.nodes().length > 0) {
        const node = cy.nodes().first();
        const nodeId = node.id();
        testHelpers.createTerminal(nodeId);
      }
    });

    // Wait for terminal to open
    await appWindow.waitForTimeout(1000);

    // Wait for terminal window to open
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const terminals = document.querySelectorAll('.cy-floating-window');
        for (const terminal of terminals) {
          const title = terminal.querySelector('.cy-floating-window-title-text');
          if (title && title.textContent?.includes('Terminal')) {
            return true;
          }
        }
        return false;
      });
    }, {
      message: 'Waiting for terminal window to open',
      timeout: 5000
    }).toBe(true);

    // Wait for xterm to initialize
    await appWindow.waitForTimeout(1000);

    // ASSERTION 1: Verify fullscreen button exists
    const fullscreenButtonExists = await appWindow.evaluate(() => {
      const fullscreenButton = document.querySelector('.cy-floating-window-fullscreen');
      return fullscreenButton !== null;
    });
    expect(fullscreenButtonExists).toBe(true);

    // Get initial terminal state BEFORE fullscreen
    const stateBeforeFullscreen = await appWindow.evaluate(() => {
      const terminalWindow = document.querySelector('.cy-floating-window') as HTMLElement;
      const contentContainer = document.querySelector('.cy-floating-window-content') as HTMLElement;

      if (!terminalWindow || !contentContainer) return null;

      return {
        windowWidth: terminalWindow.offsetWidth,
        windowHeight: terminalWindow.offsetHeight,
        contentWidth: contentContainer.offsetWidth,
        contentHeight: contentContainer.offsetHeight,
        isFullscreen: document.fullscreenElement === contentContainer
      };
    });

    console.log('State before fullscreen:', stateBeforeFullscreen);
    expect(stateBeforeFullscreen).toBeTruthy();
    expect(stateBeforeFullscreen.isFullscreen).toBe(false);

    // SCREENSHOT 1: Before fullscreen
    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'tests/screenshots/terminal-before-fullscreen.png'),
      fullPage: true
    });

    // Click the fullscreen button
    await appWindow.evaluate(() => {
      const fullscreenButton = document.querySelector('.cy-floating-window-fullscreen') as HTMLElement;
      if (fullscreenButton) {
        fullscreenButton.click();
      }
    });

    // Wait for fullscreen transition
    await appWindow.waitForTimeout(500);

    // ASSERTION 2: Verify terminal is in fullscreen mode
    const stateInFullscreen = await appWindow.evaluate(() => {
      const contentContainer = document.querySelector('.cy-floating-window-content') as HTMLElement;

      if (!contentContainer) return null;

      const isFullscreen = document.fullscreenElement === contentContainer;
      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;

      return {
        isFullscreen,
        fullscreenElementWidth: contentContainer.offsetWidth,
        fullscreenElementHeight: contentContainer.offsetHeight,
        screenWidth,
        screenHeight
      };
    });

    console.log('State in fullscreen:', stateInFullscreen);
    expect(stateInFullscreen).toBeTruthy();
    expect(stateInFullscreen.isFullscreen).toBe(true);

    // In fullscreen, the content container should fill a significant portion of the screen
    expect(stateInFullscreen.fullscreenElementWidth).toBeGreaterThan(stateBeforeFullscreen.windowWidth);
    expect(stateInFullscreen.fullscreenElementHeight).toBeGreaterThan(stateBeforeFullscreen.windowHeight);

    // SCREENSHOT 2: During fullscreen
    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'tests/screenshots/terminal-in-fullscreen.png'),
      fullPage: true
    });

    // Exit fullscreen by clicking the button again
    await appWindow.evaluate(() => {
      const fullscreenButton = document.querySelector('.cy-floating-window-fullscreen') as HTMLElement;
      if (fullscreenButton) {
        fullscreenButton.click();
      }
    });

    // Wait for fullscreen exit transition
    await appWindow.waitForTimeout(500);

    // ASSERTION 3: Verify terminal exited fullscreen mode
    const stateAfterFullscreen = await appWindow.evaluate(() => {
      const terminalWindow = document.querySelector('.cy-floating-window') as HTMLElement;
      const contentContainer = document.querySelector('.cy-floating-window-content') as HTMLElement;

      if (!terminalWindow || !contentContainer) return null;

      return {
        windowWidth: terminalWindow.offsetWidth,
        windowHeight: terminalWindow.offsetHeight,
        contentWidth: contentContainer.offsetWidth,
        contentHeight: contentContainer.offsetHeight,
        isFullscreen: document.fullscreenElement === contentContainer
      };
    });

    console.log('State after fullscreen:', stateAfterFullscreen);
    expect(stateAfterFullscreen).toBeTruthy();
    expect(stateAfterFullscreen.isFullscreen).toBe(false);

    // Terminal should return to approximately its original size
    expect(Math.abs(stateAfterFullscreen.windowWidth - stateBeforeFullscreen.windowWidth)).toBeLessThan(50);
    expect(Math.abs(stateAfterFullscreen.windowHeight - stateBeforeFullscreen.windowHeight)).toBeLessThan(50);

    // SCREENSHOT 3: After fullscreen
    await appWindow.screenshot({
      path: path.join(PROJECT_ROOT, 'tests/screenshots/terminal-after-fullscreen.png'),
      fullPage: true
    });

    console.log('✅ Fullscreen test completed successfully!');
    console.log('Screenshots saved to:');
    console.log('  - tests/screenshots/terminal-before-fullscreen.png');
    console.log('  - tests/screenshots/terminal-in-fullscreen.png');
    console.log('  - tests/screenshots/terminal-after-fullscreen.png');
  });
});
