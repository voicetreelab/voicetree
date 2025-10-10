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
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1'
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
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-test-'));
    await use(tempDir);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  },
});

test.describe('Terminal E2E Tests', () => {
  test('should open terminal from context menu and allow typing commands', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan
    await appWindow.waitForTimeout(1000);

    // Create test markdown file AFTER watching starts
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nThis is a test node for terminal testing.`
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

    // Open terminal by clicking on the menu item via evaluate (avoids viewport issues)
    await appWindow.evaluate(async () => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      if (cy && cy.nodes().length > 0) {
        const node = cy.nodes().first();
        // Trigger the cxttapstart event to open context menu
        node.emit('cxttapstart');

        // Wait for menu to render, then click the terminal option
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            const terminalOption = document.querySelector('[title="Terminal"]') as HTMLElement;
            if (terminalOption) {
              terminalOption.click();
            }
            resolve();
          }, 200);
        });
      }
    });

    // Wait for terminal to open
    await appWindow.waitForTimeout(500);

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
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan
    await appWindow.waitForTimeout(1000);

    // Create test markdown file AFTER watching starts
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nThis is a test node for terminal testing.`
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

    // Open terminal by clicking on the menu item via evaluate (avoids viewport issues)
    await appWindow.evaluate(async () => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      if (cy && cy.nodes().length > 0) {
        const node = cy.nodes().first();
        // Trigger the cxttapstart event to open context menu
        node.emit('cxttapstart');

        // Wait for menu to render, then click the terminal option
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            const terminalOption = document.querySelector('[title="Terminal"]') as HTMLElement;
            if (terminalOption) {
              terminalOption.click();
            }
            resolve();
          }, 200);
        });
      }
    });

    // Wait for terminal to open
    await appWindow.waitForTimeout(500);

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
      const terminalWindow = document.querySelector('.cy-floating-window');
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
        const terminalWindow = document.querySelector('.cy-floating-window');
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
        const terminalWindow = document.querySelector('.cy-floating-window');
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

  test('should position terminal shadow node with layout algorithm using parentId', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan
    await appWindow.waitForTimeout(1000);

    // Create multiple markdown files AFTER watching starts
    await fs.writeFile(
      path.join(tempDir, 'parent-node.md'),
      `# Parent Node\n\nThis is the parent node.`
    );
    await fs.writeFile(
      path.join(tempDir, 'child-node.md'),
      `# Child Node\n\nThis is a child. Links to [[parent-node]].`
    );

    // Wait for graph to load with multiple nodes
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        const cy = window.cytoscapeInstance;
        return cy && cy.nodes().length >= 2;
      });
    }, {
      message: 'Waiting for graph nodes to load',
      timeout: 10000
    }).toBe(true);

    // Get parent node (note: markdown filenames become IDs with hyphens, not underscores)
    const parentNodeId = 'parent-node';
    const nodeExists = await appWindow.evaluate((id) => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      const node = cy.getElementById(id);
      return node.length > 0;
    }, parentNodeId);

    expect(nodeExists).toBe(true);

    // Open terminal by clicking on the menu item via evaluate (avoids viewport issues)
    await appWindow.evaluate(async (id) => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      if (cy) {
        const node = cy.getElementById(id);
        if (node.length > 0) {
          // Trigger the cxttapstart event to open context menu
          node.emit('cxttapstart');

          // Wait for menu to render, then click the terminal option
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              const terminalOption = document.querySelector('[title="Terminal"]') as HTMLElement;
              if (terminalOption) {
                terminalOption.click();
              }
              resolve();
            }, 200);
          });
        }
      }
    }, parentNodeId);

    // Wait for terminal to open
    await appWindow.waitForTimeout(500);

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

    // Check that the terminal shadow node has the correct parentId set
    const shadowNodeData = await appWindow.evaluate((parentId) => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      const terminalId = `terminal-${parentId}`;
      const shadowNode = cy.getElementById(terminalId);

      if (shadowNode.length === 0) {
        return { exists: false };
      }

      return {
        exists: true,
        id: shadowNode.id(),
        parentId: shadowNode.data('parentId'),
        parentNodeId: shadowNode.data('parentNodeId'),
        isFloatingWindow: shadowNode.data('isFloatingWindow'),
        position: shadowNode.position()
      };
    }, parentNodeId);

    console.log('Shadow node data:', shadowNodeData);

    // CRITICAL TEST: Shadow node should have parentId set (not just parentNodeId)
    // This is what the layout algorithm looks for
    expect(shadowNodeData.exists).toBe(true);
    expect(shadowNodeData.id).toBe(`terminal-${parentNodeId}`);
    expect(shadowNodeData.isFloatingWindow).toBe(true);

    // THIS IS THE KEY ASSERTION THAT WILL FAIL:
    // The shadow node should have 'parentId' set to the parent node
    // Currently it only has 'parentNodeId', which the layout algorithm doesn't check
    expect(shadowNodeData.parentId).toBe(parentNodeId);
  });

  test('should trigger incremental layout when terminal is spawned after initial load', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan
    await appWindow.waitForTimeout(1000);

    // Create test markdown files AFTER watching starts
    await fs.writeFile(
      path.join(tempDir, 'root.md'),
      `# Root Node\n\nThis is the root.`
    );
    await fs.writeFile(
      path.join(tempDir, 'child.md'),
      `# Child Node\n\nLinks to [[root]].`
    );

    // Wait for graph to load
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        const cy = window.cytoscapeInstance;
        return cy && cy.nodes().length >= 2;
      });
    }, {
      message: 'Waiting for graph nodes to load',
      timeout: 10000
    }).toBe(true);

    // CRITICAL: Wait for initial load to complete
    // This ensures isInitialLoad = false, which is required for layout triggering
    await appWindow.waitForTimeout(2000);

    // Capture console logs to verify layout was triggered
    const consoleLogs: string[] = [];
    appWindow.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    const parentNodeId = 'root';

    // Get parent node position before spawning terminal
    const initialParentPos = await appWindow.evaluate((id) => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      const node = cy.getElementById(id);
      return node.position();
    }, parentNodeId);

    // Open terminal by clicking on the menu item via evaluate (avoids viewport issues)
    await appWindow.evaluate(async (id) => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      if (cy) {
        const node = cy.getElementById(id);
        if (node.length > 0) {
          // Trigger the cxttapstart event to open context menu
          node.emit('cxttapstart');

          // Wait for menu to render, then click the terminal option
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              const terminalOption = document.querySelector('[title="Terminal"]') as HTMLElement;
              if (terminalOption) {
                terminalOption.click();
              }
              resolve();
            }, 200);
          });
        }
      }
    }, parentNodeId);

    // Wait for terminal to open
    await appWindow.waitForTimeout(500);

    // Wait for terminal to spawn
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

    // Wait for layout to complete
    await appWindow.waitForTimeout(1000);

    // CRITICAL ASSERTIONS: Verify layout was triggered
    const layoutTriggered = consoleLogs.some(log =>
      log.includes('[createFloatingTerminal] Triggering incremental layout')
    );

    // Check that isInitialLoad was false (not blocking layout)
    const wasNotInitialLoad = consoleLogs.some(log =>
      log.includes('isInitialLoad: false')
    );

    console.log('Console logs:', consoleLogs.filter(log => log.includes('createFloatingTerminal')));

    // KEY ASSERTIONS:
    // 1. Layout should have been triggered
    expect(layoutTriggered).toBe(true);

    // 2. isInitialLoad should be false
    expect(wasNotInitialLoad).toBe(true);

    // 3. Verify shadow node position was updated by layout algorithm
    const terminalNodeData = await appWindow.evaluate((parentId) => {
      const window = globalThis as ExtendedWindow;
      const cy = window.cytoscapeInstance;
      const terminalId = `terminal-${parentId}`;
      const shadowNode = cy.getElementById(terminalId);

      if (shadowNode.length === 0) {
        return { exists: false };
      }

      return {
        exists: true,
        position: shadowNode.position(),
        hasParentId: !!shadowNode.data('parentId')
      };
    }, parentNodeId);

    expect(terminalNodeData.exists).toBe(true);
    expect(terminalNodeData.hasParentId).toBe(true);

    // The terminal shadow node should have been positioned by the layout algorithm
    // It should NOT be at the manually set position (parent.x + 100, parent.y)
    // Instead, it should be positioned according to the tree layout
    console.log('Parent initial position:', initialParentPos);
    console.log('Terminal shadow node position:', terminalNodeData.position);

    // If layout ran, the position should be different from the manual offset
    const manualOffsetX = initialParentPos.x + 100;
    const manualOffsetY = initialParentPos.y;

    // Layout should have changed the position
    const positionWasChangedByLayout =
      Math.abs(terminalNodeData.position.x - manualOffsetX) > 10 ||
      Math.abs(terminalNodeData.position.y - manualOffsetY) > 10;

    expect(positionWasChangedByLayout).toBe(true);
  });
});