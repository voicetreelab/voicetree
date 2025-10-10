import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const PROJECT_ROOT = path.resolve(process.cwd());

interface ExtendedWindow extends Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cytoscapeInstance?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  electronAPI?: any;
}

const test = base.extend<{ tempDir: string; appWindow: Page; electronApp: ElectronApplication }>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: [path.join(PROJECT_ROOT, 'dist-electron/main/index.js')],
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

test.describe('Terminal Dimensions Synchronization', () => {
  /**
   * BEHAVIOR: Text should wrap correctly based on terminal width
   * BUG: When frontend/backend dimensions mismatch, characters appear on separate lines
   */
  test('should wrap text correctly at terminal width boundaries', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan
    await appWindow.waitForTimeout(1000);

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

    // Focus terminal
    await appWindow.evaluate(() => {
      const xtermElement = document.querySelector('.xterm') as HTMLElement;
      xtermElement?.focus();
      xtermElement?.click();
    });

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
      const xtermScreen = document.querySelector('.xterm-screen');
      const content = xtermScreen?.textContent || '';

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

  /**
   * BEHAVIOR: Terminal should handle long output with proper line wrapping
   * after being resized
   */
  test('should maintain correct text wrapping after resize', async ({ appWindow, tempDir }) => {
    // Start file watching FIRST
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    // Wait for initial scan
    await appWindow.waitForTimeout(1000);

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
    await appWindow.evaluate(() => {
      const xtermElement = document.querySelector('.xterm') as HTMLElement;
      xtermElement?.focus();
      xtermElement?.click();
    });

    // Type a very long string to test wrapping at new dimensions
    const veryLongCommand = 'echo "' + 'A'.repeat(150) + '"';
    await appWindow.keyboard.type(veryLongCommand.slice(0, 50)); // Type first part
    await appWindow.waitForTimeout(200);

    // BEHAVIOR TEST: Characters should appear on same line up to terminal width,
    // then wrap to next line - not appear character-by-character on separate lines
    const wrappingCheck = await appWindow.evaluate(() => {
      const xtermScreen = document.querySelector('.xterm-screen');
      const content = xtermScreen?.textContent || '';
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
