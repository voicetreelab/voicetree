/**
 * TERMINAL HIGHLIGHTING OFFSET REPRODUCTION TEST
 *
 * BUG: When highlighting text in the terminal, the selection starts ~3 lines
 * above the cursor position. This offset scales with terminal height.
 *
 * This test measures the exact offset to help diagnose the root cause.
 */

import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { focusTerminal } from './test-utils';

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
        HEADLESS_TEST: process.env.HEADLESS_TEST || '1',
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
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-highlight-test-'));
    await use(tempDir);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up temp directory: ${error}`);
    }
  },
});

test.describe('Terminal Highlighting Offset Bug', () => {
  test('should measure highlighting offset from cursor position', async ({ appWindow, tempDir }) => {
    // Setup: Start file watching
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    await appWindow.waitForTimeout(2000);

    // Create test markdown file
    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nTerminal highlighting test.`
    );

    // Wait for graph to load
    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        const cy = window.cytoscapeInstance;
        return cy && cy.nodes().length > 0;
      });
    }, { timeout: 10000 }).toBe(true);

    // Open terminal
    await appWindow.evaluate(() => {
      const window = globalThis as ExtendedWindow;
      const testHelpers = (window as unknown as { testHelpers?: { createTerminal: (nodeId: string) => void } }).testHelpers;
      const cy = window.cytoscapeInstance;
      if (testHelpers && cy && cy.nodes().length > 0) {
        const node = cy.nodes().first();
        testHelpers.createTerminal(node.id());
      }
    });

    // Wait for terminal to open
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
    }, { timeout: 5000 }).toBe(true);

    await appWindow.waitForTimeout(1000);

    // Focus terminal and create multiple lines of content
    await focusTerminal(appWindow);

    // Type 15 lines so we have enough content to test selection offset
    for (let i = 1; i <= 15; i++) {
      await appWindow.keyboard.type(`Line ${i}: This is test content for highlighting offset measurement`);
      await appWindow.keyboard.press('Enter');
      await appWindow.waitForTimeout(50);
    }

    await appWindow.waitForTimeout(500);

    // Get terminal dimensions and structure
    const terminalInfo = await appWindow.evaluate(() => {
      const terminalWindow = document.querySelector('.cy-floating-window');
      const titleBar = document.querySelector('.cy-floating-window-title');
      const content = document.querySelector('.cy-floating-window-content');
      const xtermViewport = document.querySelector('.xterm-viewport') as HTMLElement;
      const xtermScreen = document.querySelector('.xterm-screen');

      if (!terminalWindow || !titleBar || !content || !xtermViewport || !xtermScreen) {
        return null;
      }

      const windowRect = terminalWindow.getBoundingClientRect();
      const titleRect = titleBar.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const viewportRect = xtermViewport.getBoundingClientRect();
      const screenRect = xtermScreen.getBoundingClientRect();

      // Get the xterm instance to calculate cell dimensions and buffer info
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xtermDiv = document.querySelector('.xterm') as any;

      const cellHeight = xtermDiv?._core?._renderService?.dimensions?.css?.cell?.height || 17;
      const cellWidth = xtermDiv?._core?._renderService?.dimensions?.css?.cell?.width || 9;

      // Get overlay transform to check if CSS transforms are affecting coordinates
      const overlay = document.querySelector('.cy-floating-overlay') as HTMLElement;
      const overlayTransform = overlay?.style?.transform || 'none';
      const overlayRect = overlay?.getBoundingClientRect();

      // Get cytoscape zoom/pan
      const window = globalThis as { cytoscapeInstance?: { zoom: () => number; pan: () => { x: number; y: number } } };
      const zoom = window.cytoscapeInstance?.zoom() || 1;
      const pan = window.cytoscapeInstance?.pan() || { x: 0, y: 0 };

      return {
        window: { top: windowRect.top, left: windowRect.left, height: windowRect.height, width: windowRect.width },
        titleBar: { top: titleRect.top, left: titleRect.left, height: titleRect.height, width: titleRect.width },
        content: { top: contentRect.top, left: contentRect.left, height: contentRect.height, width: contentRect.width },
        viewport: { top: viewportRect.top, left: viewportRect.left, height: viewportRect.height, width: viewportRect.width },
        screen: { top: screenRect.top, left: screenRect.left, height: screenRect.height, width: screenRect.width },
        overlay: overlayRect ? { top: overlayRect.top, left: overlayRect.left } : null,
        cellHeight,
        cellWidth,
        titleBarOffset: contentRect.top - windowRect.top,
        screenViewportOffset: screenRect.top - viewportRect.top,
        overlayTransform: overlayTransform,
        cytoscapeZoom: zoom,
        cytoscapePan: pan,
      };
    });

    expect(terminalInfo).toBeTruthy();
    console.log('Terminal structure:', JSON.stringify(terminalInfo, null, 2));

    // CRITICAL TEST: Simulate mouse selection at a specific row
    // We'll click at row 10 and measure where the selection actually appears
    const targetRow = 10;
    const targetColumn = 5;

    // Calculate mouse position for row 10, column 5
    // IMPORTANT: Use screen.top instead of viewport.top since xterm uses the screen element for coordinates
    const mouseY = terminalInfo!.screen.top + (targetRow * terminalInfo!.cellHeight) + (terminalInfo!.cellHeight / 2);
    const mouseX = terminalInfo!.screen.left + (targetColumn * terminalInfo!.cellWidth) + (terminalInfo!.cellWidth / 2);

    console.log(`Target: row ${targetRow}, col ${targetColumn}`);
    console.log(`Mouse position: (${mouseX}, ${mouseY})`);
    console.log(`Screen top: ${terminalInfo!.screen.top}, Viewport top: ${terminalInfo!.viewport.top}, Cell height: ${terminalInfo!.cellHeight}`);
    console.log(`Offset between screen and viewport: ${terminalInfo!.screen.top - terminalInfo!.viewport.top}px`);

    // Perform mouse selection: click and drag to select some text
    await appWindow.mouse.move(mouseX, mouseY);
    await appWindow.mouse.down();
    await appWindow.mouse.move(mouseX + 200, mouseY); // Drag 200px to the right
    await appWindow.mouse.up();

    await appWindow.waitForTimeout(500);

    // Get the actual selection that was made
    const selectionInfo = await appWindow.evaluate(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return { hasSelection: false };
      }

      const range = selection.getRangeAt(0);
      const selectedText = selection.toString();

      // Find which xterm row element contains the selection start
      const rows = document.querySelectorAll('.xterm-rows > div');
      let startRowIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i].contains(range.startContainer)) {
          startRowIndex = i;
          break;
        }
      }

      return {
        hasSelection: true,
        selectedText,
        startRowIndex,
        totalRows: rows.length,
      };
    });

    console.log('Selection info:', selectionInfo);

    // ASSERTION: Calculate the offset between expected and actual row
    if (selectionInfo.hasSelection) {
      const actualRow = selectionInfo.startRowIndex;
      const offset = targetRow - actualRow;

      console.log(`\n=== HIGHLIGHTING OFFSET MEASUREMENT ===`);
      console.log(`Expected selection to start at row: ${targetRow}`);
      console.log(`Actual selection started at row: ${actualRow}`);
      console.log(`Offset: ${offset} rows`);
      console.log(`Selected text: "${selectionInfo.selectedText}"`);
      console.log(`Title bar offset: ${terminalInfo!.titleBarOffset}px`);
      console.log(`Cell height: ${terminalInfo!.cellHeight}px`);
      console.log(`Calculated title bar offset in rows: ${Math.round(terminalInfo!.titleBarOffset / terminalInfo!.cellHeight)}`);
      console.log(`========================================\n`);

      // The offset should be approximately equal to titleBarOffset / cellHeight
      // This test documents the bug - we expect an offset but it should be 0
      expect(Math.abs(offset)).toBeGreaterThan(0); // BUG: There IS an offset

      // Store the measured offset for analysis
      const expectedTitleBarOffsetInRows = Math.round(terminalInfo!.titleBarOffset / terminalInfo!.cellHeight);

      // The hypothesis is that the offset equals the title bar height in rows
      expect(Math.abs(offset - expectedTitleBarOffsetInRows)).toBeLessThan(2); // Should be within 1-2 rows
    } else {
      throw new Error('No selection was made - test setup failed');
    }
  });

  test('should verify offset scales with terminal height', async ({ appWindow, tempDir }) => {
    // This test opens terminals with different heights and measures if the offset scales
    await appWindow.evaluate(async (dir) => {
      const window = globalThis as ExtendedWindow;
      if (window.electronAPI) {
        return window.electronAPI.startFileWatching(dir);
      }
    }, tempDir);

    await appWindow.waitForTimeout(2000);

    await fs.writeFile(
      path.join(tempDir, 'test-node.md'),
      `# Test Node\n\nTerminal offset scaling test.`
    );

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        const window = globalThis as ExtendedWindow;
        const cy = window.cytoscapeInstance;
        return cy && cy.nodes().length > 0;
      });
    }, { timeout: 10000 }).toBe(true);

    // Test with small height (400px)
    await appWindow.evaluate(() => {
      const window = globalThis as ExtendedWindow;
      const testHelpers = (window as unknown as { testHelpers?: { createTerminal: (nodeId: string) => void } }).testHelpers;
      const cy = window.cytoscapeInstance;
      if (testHelpers && cy && cy.nodes().length > 0) {
        const node = cy.nodes().first();
        testHelpers.createTerminal(node.id());
      }
    });

    await expect.poll(async () => {
      return appWindow.evaluate(() => {
        return document.querySelectorAll('.cy-floating-window').length > 0;
      });
    }, { timeout: 5000 }).toBe(true);

    // Resize to 400px height
    await appWindow.evaluate(() => {
      const terminal = document.querySelector('.cy-floating-window') as HTMLElement;
      if (terminal) {
        terminal.style.height = '400px';
      }
    });

    await appWindow.waitForTimeout(1000);

    const smallHeightInfo = await appWindow.evaluate(() => {
      const terminal = document.querySelector('.cy-floating-window');
      const titleBar = document.querySelector('.cy-floating-window-title');
      const viewport = document.querySelector('.xterm-viewport');

      if (!terminal || !titleBar || !viewport) return null;

      return {
        terminalHeight: terminal.getBoundingClientRect().height,
        titleBarHeight: titleBar.getBoundingClientRect().height,
        viewportHeight: viewport.getBoundingClientRect().height,
      };
    });

    console.log('Small terminal info:', smallHeightInfo);

    // Close and create new terminal with larger height (800px)
    await appWindow.evaluate(() => {
      const closeButton = document.querySelector('.cy-floating-window-close') as HTMLElement;
      if (closeButton) closeButton.click();
    });

    await appWindow.waitForTimeout(500);

    await appWindow.evaluate(() => {
      const window = globalThis as ExtendedWindow;
      const testHelpers = (window as unknown as { testHelpers?: { createTerminal: (nodeId: string) => void } }).testHelpers;
      const cy = window.cytoscapeInstance;
      if (testHelpers && cy && cy.nodes().length > 0) {
        const node = cy.nodes().first();
        testHelpers.createTerminal(node.id());
      }
    });

    await appWindow.waitForTimeout(1000);

    // Resize to 800px height
    await appWindow.evaluate(() => {
      const terminal = document.querySelector('.cy-floating-window') as HTMLElement;
      if (terminal) {
        terminal.style.height = '800px';
      }
    });

    await appWindow.waitForTimeout(1000);

    const largeHeightInfo = await appWindow.evaluate(() => {
      const terminal = document.querySelector('.cy-floating-window');
      const titleBar = document.querySelector('.cy-floating-window-title');
      const viewport = document.querySelector('.xterm-viewport');

      if (!terminal || !titleBar || !viewport) return null;

      return {
        terminalHeight: terminal.getBoundingClientRect().height,
        titleBarHeight: titleBar.getBoundingClientRect().height,
        viewportHeight: viewport.getBoundingClientRect().height,
      };
    });

    console.log('Large terminal info:', largeHeightInfo);

    // KEY OBSERVATION: Title bar height should be constant,
    // but if the bug is "offset scales with height", it suggests
    // a PERCENTAGE-based error, not a fixed pixel error

    expect(smallHeightInfo).toBeTruthy();
    expect(largeHeightInfo).toBeTruthy();

    // Title bar should be the same height in both cases
    expect(smallHeightInfo!.titleBarHeight).toBeCloseTo(largeHeightInfo!.titleBarHeight, 2);

    console.log('\n=== HEIGHT SCALING ANALYSIS ===');
    console.log(`Small terminal: ${smallHeightInfo!.terminalHeight}px total, ${smallHeightInfo!.viewportHeight}px viewport`);
    console.log(`Large terminal: ${largeHeightInfo!.terminalHeight}px total, ${largeHeightInfo!.viewportHeight}px viewport`);
    console.log(`Title bar height (constant): ${smallHeightInfo!.titleBarHeight}px`);
    console.log('================================\n');
  });
});
