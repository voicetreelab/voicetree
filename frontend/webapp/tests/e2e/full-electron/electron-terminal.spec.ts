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

    // 4. Verify environment variables are set for the node
    await appWindow.waitForTimeout(500);

    // Type command to check environment variable
    const envCheckCommand = 'echo $OBSIDIAN_SOURCE_NAME';
    await appWindow.keyboard.type(envCheckCommand);
    await appWindow.keyboard.press('Enter');

    // Wait for output
    await appWindow.waitForTimeout(1000);

    // Get terminal content after env check
    const envCheckContent = await appWindow.evaluate(() => {
      const xtermScreen = document.querySelector('.xterm-screen');
      return xtermScreen?.textContent || '';
    });

    console.log('Terminal content after env check:', envCheckContent);

    // Verify the environment variable contains the node name (test node or test-node)
    expect(envCheckContent).toMatch(/test[\s-]node/i);
  });

  test('should handle terminal resize properly without visual artifacts or text loss', async ({ appWindow, tempDir }) => {
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
    await appWindow.waitForTimeout(500);

    // Find and click the terminal option in the context menu
    const terminalMenuOption = await appWindow.evaluate(() => {
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

    // Focus and add some test content to the terminal
    await appWindow.evaluate(() => {
      const xtermElement = document.querySelector('.xterm') as HTMLElement;
      if (xtermElement) {
        xtermElement.focus();
        xtermElement.click();
      }
    });

    // Type some test content that we can verify after resize
    const testText = 'echo "This is test content for resize verification"';
    await appWindow.keyboard.type(testText);
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    // Get initial terminal state
    const initialState = await appWindow.evaluate(() => {
      const terminalWindow = document.querySelector('.floating-window');
      const xtermScreen = document.querySelector('.xterm-screen');
      const xtermViewport = document.querySelector('.xterm-viewport') as HTMLElement;

      if (!terminalWindow) return null;

      const rect = terminalWindow.getBoundingClientRect();
      const content = xtermScreen?.textContent || '';
      const viewportStyle = window.getComputedStyle(xtermViewport);

      return {
        width: rect.width,
        height: rect.height,
        content: content,
        backgroundColor: viewportStyle.backgroundColor,
        hasContent: content.length > 0
      };
    });

    expect(initialState).toBeTruthy();
    expect(initialState.hasContent).toBe(true);
    expect(initialState.content).toContain('test content');

    // Test 1: Resize LARGER and check for visual artifacts (white/black rectangles)
    const resizeHandleLarger = await appWindow.evaluate(() => {
      const handle = document.querySelector('.resize-handle-corner');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (resizeHandleLarger) {
      // Drag to make window larger
      await appWindow.mouse.move(resizeHandleLarger.x, resizeHandleLarger.y);
      await appWindow.mouse.down();
      await appWindow.mouse.move(resizeHandleLarger.x + 200, resizeHandleLarger.y + 150);
      await appWindow.mouse.up();
      await appWindow.waitForTimeout(500);

      // Check state after enlarging
      const enlargedState = await appWindow.evaluate(() => {
        const terminalWindow = document.querySelector('.floating-window');
        const xtermScreen = document.querySelector('.xterm-screen');
        const xtermViewport = document.querySelector('.xterm-viewport') as HTMLElement;

        if (!terminalWindow) return null;

        const rect = terminalWindow.getBoundingClientRect();
        const content = xtermScreen?.textContent || '';
        const viewportStyle = window.getComputedStyle(xtermViewport);

        // Check for visual artifacts (white rectangles)
        const hasWhiteArtifact = viewportStyle.backgroundColor === 'rgb(255, 255, 255)' ||
                                 viewportStyle.backgroundColor === 'white';

        return {
          width: rect.width,
          height: rect.height,
          content: content,
          backgroundColor: viewportStyle.backgroundColor,
          hasWhiteArtifact: hasWhiteArtifact,
          contentPreserved: content.includes('test content')
        };
      });

      // BUG REPRODUCTION: Terminal should NOT show white rectangles or lose content when enlarged
      expect(enlargedState.width).toBeGreaterThan(initialState.width);
      expect(enlargedState.height).toBeGreaterThan(initialState.height);
      expect(enlargedState.hasWhiteArtifact).toBe(false); // Should not have white background artifact
      expect(enlargedState.contentPreserved).toBe(true); // Content should still be visible
    }

    // Test 2: Resize SMALLER and check for text loss
    const resizeHandleSmaller = await appWindow.evaluate(() => {
      const handle = document.querySelector('.resize-handle-corner');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (resizeHandleSmaller) {
      // Drag to make window smaller
      await appWindow.mouse.move(resizeHandleSmaller.x, resizeHandleSmaller.y);
      await appWindow.mouse.down();
      await appWindow.mouse.move(resizeHandleSmaller.x - 150, resizeHandleSmaller.y - 100);
      await appWindow.mouse.up();
      await appWindow.waitForTimeout(500);

      // Check state after shrinking
      const shrunkState = await appWindow.evaluate(() => {
        const terminalWindow = document.querySelector('.floating-window');
        const xtermScreen = document.querySelector('.xterm-screen');

        if (!terminalWindow) return null;

        const rect = terminalWindow.getBoundingClientRect();
        const content = xtermScreen?.textContent || '';

        return {
          width: rect.width,
          height: rect.height,
          content: content,
          contentPreserved: content.includes('test content')
        };
      });

      // BUG REPRODUCTION: Terminal should NOT lose text when made smaller
      expect(shrunkState.width).toBeLessThan(initialState.width);
      expect(shrunkState.height).toBeLessThan(initialState.height);
      expect(shrunkState.contentPreserved).toBe(true); // Text should wrap, not be lost
    }

    // Test 3: Verify terminal remains functional after resizing
    await appWindow.evaluate(() => {
      const xtermElement = document.querySelector('.xterm') as HTMLElement;
      if (xtermElement) {
        xtermElement.focus();
        xtermElement.click();
      }
    });

    const postResizeCommand = 'echo "After resize"';
    await appWindow.keyboard.type(postResizeCommand);
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    const finalContent = await appWindow.evaluate(() => {
      const xtermScreen = document.querySelector('.xterm-screen');
      return xtermScreen?.textContent || '';
    });

    // Terminal should still be functional after resizing
    expect(finalContent).toContain('After resize');
  });
});