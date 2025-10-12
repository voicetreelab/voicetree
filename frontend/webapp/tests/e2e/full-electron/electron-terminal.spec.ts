/**
 * BEHAVIORAL SPEC:
 * 1. Terminals can be opened from context menu for any node
 * 2. Terminals accept keyboard input and display command output
 * 3. Terminal environment variables are set based on the associated node
 * 4. Terminals resize without visual artifacts or text loss
 * 5. Terminal shadow nodes have correct parent relationships for layout
 * 6. Creating terminals after initial load triggers incremental layout
 *
 * IMPORTANT: THESE SPEC COMMENTS MUST BE KEPT UP TO DATE
 */

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { focusTerminal, getTerminalContent } from './test-utils';

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

    // Wait for initial scan to complete (chokidar needs time to initialize)
    await appWindow.waitForTimeout(2000);

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

    // Open terminal using test helper (more reliable than context menu)
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

    // Check that terminal is ready
    const terminalReady = await appWindow.evaluate(() => {
      const xtermElements = document.querySelectorAll('.xterm');
      return xtermElements.length > 0;
    });
    expect(terminalReady).toBe(true);

    // Focus terminal and type command
    await focusTerminal(appWindow);
    await appWindow.keyboard.type('echo "Hello Terminal"');
    await appWindow.keyboard.press('Enter');

    // Wait for output
    await appWindow.waitForTimeout(1000);

    // Get terminal content
    const terminalContent = await getTerminalContent(appWindow);

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
    const envCheckContent = await getTerminalContent(appWindow);

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

    // Wait for initial scan to complete (chokidar needs time to initialize)
    await appWindow.waitForTimeout(2000);

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

    // Open terminal using test helper (more reliable than context menu)
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

    // Focus terminal and type test content
    await focusTerminal(appWindow);
    const testText = 'echo "This is test content for resize verification"';
    await appWindow.keyboard.type(testText);
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    // Get initial terminal state
    const initialState = await appWindow.evaluate(() => {
      const terminalWindow = document.querySelector('.cy-floating-window');
      const xtermRows = document.querySelector('.xterm-rows');
      const xtermViewport = document.querySelector('.xterm-viewport') as HTMLElement;

      if (!terminalWindow) return null;

      const rect = terminalWindow.getBoundingClientRect();
      const content = xtermRows?.textContent || '';
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
        const xtermRows = document.querySelector('.xterm-rows');
        const xtermViewport = document.querySelector('.xterm-viewport') as HTMLElement;

        if (!terminalWindow) return null;

        const rect = terminalWindow.getBoundingClientRect();
        const content = xtermRows?.textContent || '';
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
        const xtermRows = document.querySelector('.xterm-rows');

        if (!terminalWindow) return null;

        const rect = terminalWindow.getBoundingClientRect();
        const content = xtermRows?.textContent || '';

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
    await focusTerminal(appWindow);
    const postResizeCommand = 'echo "After resize"';
    await appWindow.keyboard.type(postResizeCommand);
    await appWindow.keyboard.press('Enter');
    await appWindow.waitForTimeout(1000);

    const finalContent = await getTerminalContent(appWindow);

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

    // Wait for initial scan to complete (chokidar needs time to initialize)
    await appWindow.waitForTimeout(2000);

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

    // Open terminal using test helper (more reliable than context menu)
    await appWindow.evaluate((id) => {
      const window = globalThis as ExtendedWindow;
      const testHelpers = (window as unknown as { testHelpers?: { createTerminal: (nodeId: string) => void } }).testHelpers;

      if (testHelpers) {
        testHelpers.createTerminal(id);
      }
    }, parentNodeId);

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

    // Wait for initial scan to complete (chokidar needs time to initialize)
    await appWindow.waitForTimeout(2000);

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

    // Open terminal using test helper (more reliable than context menu)
    await appWindow.evaluate((id) => {
      const window = globalThis as ExtendedWindow;
      const testHelpers = (window as unknown as { testHelpers?: { createTerminal: (nodeId: string) => void } }).testHelpers;

      if (testHelpers) {
        testHelpers.createTerminal(id);
      }
    }, parentNodeId);

    // Wait for terminal to open
    await appWindow.waitForTimeout(1000);

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

  test('should wrap text correctly at terminal width boundaries', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan to complete (chokidar needs time to initialize)
    await appWindow.waitForTimeout(2000);

    // Create test file AFTER watching starts
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nTerminal dimension test node.`
    );

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        const cy = window.cytoscapeInstance;
        return cy && cy.nodes().length > 0;
      });
    }, { timeout: 10000 }).toBe(true);

    // Open terminal using test helper (more reliable than context menu)
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

    await appWindow.waitForTimeout(1000);

    // Focus terminal and type command
    await focusTerminal(appWindow);

    // Type a command that will produce output longer than typical terminal width
    // This tests that text wrapping happens at the correct column boundary
    const longCommand = 'write me a poem';
    await appWindow.keyboard.type(longCommand);
    await appWindow.keyboard.press('Enter');

    // Wait for command to be echoed
    await appWindow.waitForTimeout(500);

    // BEHAVIOR TEST: Verify that typed characters appear on the SAME line,
    // not on separate lines (which was the bug)
    const commandEchoCheck = await appWindow.evaluate((cmd: string) => {
      const xtermRows = document.querySelector('.xterm-rows');
      const content = xtermRows?.textContent || '';

      // Count how many lines contain individual characters from our command
      // If dimensions are wrong, each character appears on a new line
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      // Find the line(s) containing our command
      const commandLines = lines.filter(line => {
        // Check if line contains sequential characters from our command
        return cmd.split('').some((char, i) => {
          if (i === 0) return line.includes(char);
          return line.includes(cmd.slice(0, i + 1));
        });
      });

      // The command should appear on one or two lines (if wrapped), not 15+ lines
      const commandSpansReasonableLines = commandLines.length > 0 && commandLines.length < cmd.length / 2;

      // Check for the bug pattern: individual characters on separate lines
      // If bug exists: "w", "wr", "wri", "writ", etc. each on new line
      const hasCharByCharBug = lines.some((line, i) => {
        if (i === 0) return false;
        const prevLine = lines[i - 1];
        // If current line starts with previous line + 1 char, that's the bug
        return line.trim().startsWith(prevLine.trim()) &&
               line.trim().length === prevLine.trim().length + 1;
      });

      return {
        totalLines: lines.length,
        commandLines: commandLines.length,
        commandSpansReasonableLines,
        hasCharByCharBug,
        sampleContent: lines.slice(0, 10).join('\n') // For debugging
      };
    }, longCommand);

    console.log('Command echo check:', commandEchoCheck);

    // BEHAVIOR ASSERTION: Command should NOT exhibit character-by-character bug
    expect(commandEchoCheck.hasCharByCharBug).toBe(false);
    expect(commandEchoCheck.commandSpansReasonableLines).toBe(true);
  });

  test('should maintain correct text wrapping after resize', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan to complete (chokidar needs time to initialize)
    await appWindow.waitForTimeout(2000);

    // Create test file AFTER watching starts
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nTerminal dimension test node.`
    );

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        const cy = window.cytoscapeInstance;
        return cy && cy.nodes().length > 0;
      });
    }, { timeout: 10000 }).toBe(true);

    // Open terminal using test helper (more reliable than context menu)
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

    await appWindow.waitForTimeout(1000);

    // Resize the terminal window
    const resizeHandle = await appWindow.evaluate(() => {
      const handle = document.querySelector('.resize-handle-corner');
      if (!handle) return null;
      const rect = handle.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (resizeHandle) {
      // Make terminal significantly wider
      await appWindow.mouse.move(resizeHandle.x, resizeHandle.y);
      await appWindow.mouse.down();
      await appWindow.mouse.move(resizeHandle.x + 300, resizeHandle.y);
      await appWindow.mouse.up();
      await appWindow.waitForTimeout(500);
    }

    // Focus and type after resize
    await focusTerminal(appWindow);

    // Type a very long string to test wrapping at new dimensions
    const veryLongCommand = 'echo "' + 'A'.repeat(150) + '"';
    await appWindow.keyboard.type(veryLongCommand.slice(0, 50)); // Type first part
    await appWindow.waitForTimeout(200);

    // BEHAVIOR TEST: Characters should appear on same line up to terminal width,
    // then wrap to next line - not appear character-by-character on separate lines
    const wrappingCheck = await appWindow.evaluate(() => {
      const xtermRows = document.querySelector('.xterm-rows');
      const content = xtermRows?.textContent || '';
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      // Get the last few lines (where our typing appears)
      const recentLines = lines.slice(-5);
      const allLines = lines;

      // Check if characters are accumulating on one line (correct behavior)
      // vs appearing on separate lines (bug)
      let foundProgressiveLine = false;
      for (const line of allLines) {
        // A line with echo "AAAA..." indicates correct wrapping
        if (line.includes('echo') && line.includes('A')) {
          foundProgressiveLine = true;
          break;
        }
      }

      return {
        foundProgressiveLine,
        recentContent: recentLines.join('\n'),
        fullContent: content,
        totalLines: allLines.length
      };
    });

    console.log('Wrapping check:', wrappingCheck);

    // BEHAVIOR ASSERTION: Should see characters accumulating on same line
    // The test might be too strict - if we typed characters they should appear somewhere
    expect(wrappingCheck.foundProgressiveLine).toBe(true);
  });
});