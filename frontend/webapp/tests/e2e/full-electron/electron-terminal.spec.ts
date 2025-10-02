import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Use absolute path from project root
const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow extends Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cytoscapeInstance?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  electronAPI?: any;
}

// Custom test fixture that provides tempDir
const test = base.extend<{ tempDir: string; appWindow: Page; electronApp: ElectronApplication }>({
  tempDir: async ({}, use) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-test-'));
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

    // Wait for the app to be ready
    await expect.poll(async () => {
      return appWindow.evaluate(() => document.readyState === 'complete');
    }).toBe(true);

    await use(appWindow);
  },
});

test.describe('Terminal E2E Tests', () => {
  test.beforeEach(async ({ tempDir }) => {
    // Create test markdown files
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nThis is a test node for terminal testing.`
    );
  });

  test('should open terminal from context menu and allow typing commands', async ({ appWindow, tempDir }) => {
    // Start file watching
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

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

    // Get first node position and right-click on it
    const nodePosition = await appWindow.evaluate(() => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      if (!cy) return null;
      const node = cy.nodes().first();
      return node.renderedPosition();
    });

    expect(nodePosition).toBeTruthy();

    // Right-click on the node to open context menu
    await appWindow.mouse.click(nodePosition.x, nodePosition.y, { button: 'right' });

    // Wait for context menu to appear
    await appWindow.waitForTimeout(500);

    // Find and click the terminal option in the context menu
    const terminalMenuOption = await appWindow.evaluate(() => {
      // Look for the terminal icon in the context menu
      const menus = document.querySelectorAll('.cxtmenu-item');
      for (const menu of menus) {
        const svg = menu.querySelector('svg');
        if (svg && menu.getAttribute('title') === 'Terminal') {
          return {
            found: true,
            element: menu.getBoundingClientRect()
          };
        }
      }
      return { found: false };
    });

    expect(terminalMenuOption.found).toBe(true);

    // Click on terminal menu option
    await appWindow.mouse.click(
      terminalMenuOption.element.x + terminalMenuOption.element.width / 2,
      terminalMenuOption.element.y + terminalMenuOption.element.height / 2
    );

    // Wait for terminal window to open
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const terminals = document.querySelectorAll('.floating-window');
        for (const terminal of terminals) {
          const title = terminal.querySelector('.window-title-bar span');
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

    // Check that terminal is ready
    const terminalReady = await appWindow.evaluate(() => {
      const xtermElements = document.querySelectorAll('.xterm');
      return xtermElements.length > 0;
    });
    expect(terminalReady).toBe(true);

    // Try to type in the terminal
    const testCommand = 'echo "Hello Terminal"';

    // Focus on the terminal
    await appWindow.evaluate(() => {
      const xtermElement = document.querySelector('.xterm') as HTMLElement;
      if (xtermElement) {
        xtermElement.focus();
        xtermElement.click();
      }
    });

    // Type the command
    await appWindow.keyboard.type(testCommand);
    await appWindow.keyboard.press('Enter');

    // Wait for output
    await appWindow.waitForTimeout(1000);

    // Check if the command was executed and output appears
    const terminalContent = await appWindow.evaluate(() => {
      const xtermScreen = document.querySelector('.xterm-screen');
      return xtermScreen?.textContent || '';
    });

    console.log('Terminal content:', terminalContent);

    // Verify that:
    // 1. The command we typed appears in the terminal
    expect(terminalContent).toContain('echo');

    // 2. The output appears
    expect(terminalContent).toContain('Hello Terminal');

    // 3. Terminal is interactive (has prompt)
    expect(terminalContent.length).toBeGreaterThan(0);
  });

  test('should handle terminal resize properly', async ({ appWindow, tempDir }) => {
    // Start file watching
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

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

    // Open terminal through evaluation (simpler for this test)
    await appWindow.evaluate(() => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      if (cy) {
        // Trigger terminal opening through the context menu callback
        const event = new CustomEvent('openTerminal');
        document.dispatchEvent(event);
      }
    });

    // Actually, let's trigger it properly through the floating windows system
    await appWindow.evaluate(() => {
      const openWindowEvent = new CustomEvent('open-floating-window', {
        detail: {
          nodeId: `terminal-test-${Date.now()}`,
          title: 'Terminal Test',
          type: 'Terminal',
          content: '',
          position: { x: 100, y: 100 },
          size: { width: 800, height: 400 }
        }
      });
      document.dispatchEvent(openWindowEvent);
    });

    // Wait for terminal window to open
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const terminals = document.querySelectorAll('.floating-window');
        return terminals.length > 0;
      });
    }, {
      message: 'Waiting for terminal window to open',
      timeout: 5000
    }).toBe(true);

    // Get initial terminal size
    const initialSize = await appWindow.evaluate(() => {
      const terminalWindow = document.querySelector('.floating-window');
      if (!terminalWindow) return null;
      const rect = terminalWindow.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

    expect(initialSize).toBeTruthy();
    expect(initialSize.width).toBeCloseTo(800, 0);
    expect(initialSize.height).toBeCloseTo(400, 0);

    // Resize the terminal window
    const resizeHandle = await appWindow.evaluate(() => {
      const handle = document.querySelector('.resize-handle-corner');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (resizeHandle) {
      await appWindow.mouse.move(resizeHandle.x, resizeHandle.y);
      await appWindow.mouse.down();
      await appWindow.mouse.move(resizeHandle.x + 100, resizeHandle.y + 100);
      await appWindow.mouse.up();

      // Check new size
      const newSize = await appWindow.evaluate(() => {
        const terminalWindow = document.querySelector('.floating-window');
        if (!terminalWindow) return null;
        const rect = terminalWindow.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });

      expect(newSize.width).toBeGreaterThan(initialSize.width);
      expect(newSize.height).toBeGreaterThan(initialSize.height);
    }
  });
});