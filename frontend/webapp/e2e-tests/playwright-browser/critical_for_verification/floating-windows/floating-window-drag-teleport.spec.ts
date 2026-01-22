/**
 * Browser-based test for floating window drag teleportation bug
 *
 * Bug context: When dragging a floating window by its title bar, the window
 * teleports several hundred pixels from its current position instead of
 * starting the drag from where it currently is.
 *
 * This test opens a node, triggers its editor, drags the editor window
 * by a small amount (2 pixels), and asserts that the window moved only
 * by that small amount rather than teleporting elsewhere.
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

// Custom fixture to capture console logs and only show on failure
type ConsoleCapture = {
  consoleLogs: string[];
  pageErrors: string[];
  testLogs: string[];
};

const test = base.extend<{ consoleCapture: ConsoleCapture }>({
  consoleCapture: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const testLogs: string[] = [];

    page.on('console', msg => {
      consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', error => {
      pageErrors.push(`[Browser Error] ${error.message}\n${error.stack ?? ''}`);
    });

    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      testLogs.push(args.map(arg => String(arg)).join(' '));
    };

    await use({ consoleLogs, pageErrors, testLogs });

    console.log = originalLog;

    if (testInfo.status !== 'passed') {
      console.log('\n=== Test Logs ===');
      testLogs.forEach(log => console.log(log));
      console.log('\n=== Browser Console Logs ===');
      consoleLogs.forEach(log => console.log(log));
      if (pageErrors.length > 0) {
        console.log('\n=== Browser Errors ===');
        pageErrors.forEach(err => console.log(err));
      }
    }
  }
});

test.describe('Floating Window Drag Teleportation Bug', () => {
  test('dragging window by a few pixels should only move it by that amount', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting floating window drag teleportation test ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('OK Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('OK React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('OK Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Drag Test Node\nTesting that drag does not teleport.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'drag-test-node.md',
          contentWithoutYamlOrLinks: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(30);
    console.log('OK Graph delta sent');

    console.log('=== Step 5: Open editor via tap event ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#drag-test-node.md');
      if (node.length === 0) throw new Error('drag-test-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(100);
    console.log('OK Tap event triggered');

    console.log('=== Step 6: Verify editor window appeared ===');
    const editorSelector = '#window-drag-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('OK Editor window appeared');

    console.log('=== Step 7: Wait for layout to settle ===');
    await page.waitForTimeout(500);

    console.log('=== Step 8: Get initial window position ===');
    const initialPosition = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      if (!windowEl) throw new Error('Editor window not found');
      const rect = windowEl.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        styleLeft: parseFloat(windowEl.style.left) || 0,
        styleTop: parseFloat(windowEl.style.top) || 0
      };
    }, editorSelector);
    console.log(`  Initial position: left=${initialPosition.left}, top=${initialPosition.top}`);
    console.log(`  Initial style: left=${initialPosition.styleLeft}px, top=${initialPosition.styleTop}px`);

    console.log('=== Step 9: Get horizontal menu position for dragging ===');
    // Phase 1 refactor: editors no longer have title bars, drag is done via the horizontal menu
    const menuBarSelector = `${editorSelector} .cy-floating-window-horizontal-menu`;
    const menuBarBounds = await page.evaluate((selector) => {
      const menuBar = document.querySelector(selector) as HTMLElement;
      if (!menuBar) throw new Error('Horizontal menu bar not found');
      const rect = menuBar.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }, menuBarSelector);
    console.log(`  Menu bar center: x=${menuBarBounds.x}, y=${menuBarBounds.y}`);

    console.log('=== Step 10: Perform small drag (5 pixels right, 5 pixels down) ===');
    const dragDeltaX = 5;
    const dragDeltaY = 5;

    // Simulate drag: mousedown at menu bar center, mousemove by delta, mouseup
    await page.mouse.move(menuBarBounds.x, menuBarBounds.y);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(menuBarBounds.x + dragDeltaX, menuBarBounds.y + dragDeltaY);
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(100);
    console.log(`OK Dragged ${dragDeltaX}px right, ${dragDeltaY}px down`);

    console.log('=== Step 11: Get final window position ===');
    const finalPosition = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      if (!windowEl) throw new Error('Editor window not found');
      const rect = windowEl.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        styleLeft: parseFloat(windowEl.style.left) || 0,
        styleTop: parseFloat(windowEl.style.top) || 0
      };
    }, editorSelector);
    console.log(`  Final position: left=${finalPosition.left}, top=${finalPosition.top}`);
    console.log(`  Final style: left=${finalPosition.styleLeft}px, top=${finalPosition.styleTop}px`);

    console.log('=== Step 12: Calculate position delta ===');
    const actualDeltaX = finalPosition.left - initialPosition.left;
    const actualDeltaY = finalPosition.top - initialPosition.top;
    console.log(`  Actual delta: x=${actualDeltaX}, y=${actualDeltaY}`);
    console.log(`  Expected delta: x≈${dragDeltaX}, y≈${dragDeltaY}`);

    console.log('=== Step 13: Assert position change is close to drag delta ===');
    // Allow tolerance of 20 pixels for rounding/transform effects
    // If teleport bug exists, delta will be hundreds of pixels
    const tolerance = 20;

    const deltaXDiff = Math.abs(actualDeltaX - dragDeltaX);
    const deltaYDiff = Math.abs(actualDeltaY - dragDeltaY);

    console.log(`  Delta X difference from expected: ${deltaXDiff}px (tolerance: ${tolerance}px)`);
    console.log(`  Delta Y difference from expected: ${deltaYDiff}px (tolerance: ${tolerance}px)`);

    // This assertion will fail if teleport bug exists (delta would be ~hundreds of pixels)
    expect(deltaXDiff).toBeLessThan(tolerance);
    expect(deltaYDiff).toBeLessThan(tolerance);

    console.log('OK Window moved approximately by the expected drag amount');

    // Additional check: the window shouldn't have moved more than 50px in any direction
    // This catches the teleportation bug where window jumps hundreds of pixels
    const maxAllowedMovement = 50;
    expect(Math.abs(actualDeltaX)).toBeLessThan(maxAllowedMovement);
    expect(Math.abs(actualDeltaY)).toBeLessThan(maxAllowedMovement);

    console.log('OK No teleportation detected');
    console.log('\n=== Floating window drag teleportation test completed ===');
  });

  test('dragging window after zoom should still work correctly', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting drag-after-zoom test ===');

    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create node
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'drag-zoom-test.md',
          contentWithoutYamlOrLinks: '# Drag Zoom Test',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(30);

    // Open editor
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#drag-zoom-test.md');
      if (node.length === 0) throw new Error('drag-zoom-test.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(100);

    const editorSelector = '#window-drag-zoom-test\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    await page.waitForTimeout(300);

    console.log('=== Apply zoom ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      cy.zoom(1.5);
    });
    await page.waitForTimeout(200);
    console.log('OK Zoomed to 1.5x');

    // Get position after zoom
    const initialPosition = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      if (!windowEl) throw new Error('Editor window not found');
      const rect = windowEl.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    }, editorSelector);
    console.log(`  Position after zoom: left=${initialPosition.left}, top=${initialPosition.top}`);

    // Get horizontal menu position (Phase 1 refactor: editors no longer have title bars)
    const menuBarSelector = `${editorSelector} .cy-floating-window-horizontal-menu`;
    const menuBarBounds = await page.evaluate((selector) => {
      const menuBar = document.querySelector(selector) as HTMLElement;
      if (!menuBar) throw new Error('Horizontal menu bar not found');
      const rect = menuBar.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }, menuBarSelector);

    // Drag window
    const dragDeltaX = 10;
    const dragDeltaY = 10;
    await page.mouse.move(menuBarBounds.x, menuBarBounds.y);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(menuBarBounds.x + dragDeltaX, menuBarBounds.y + dragDeltaY);
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Get final position
    const finalPosition = await page.evaluate((selector) => {
      const windowEl = document.querySelector(selector) as HTMLElement;
      if (!windowEl) throw new Error('Editor window not found');
      const rect = windowEl.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    }, editorSelector);
    console.log(`  Final position: left=${finalPosition.left}, top=${finalPosition.top}`);

    const actualDeltaX = finalPosition.left - initialPosition.left;
    const actualDeltaY = finalPosition.top - initialPosition.top;
    console.log(`  Actual delta: x=${actualDeltaX}, y=${actualDeltaY}`);

    // Assert no teleportation
    const tolerance = 25;
    expect(Math.abs(actualDeltaX - dragDeltaX)).toBeLessThan(tolerance);
    expect(Math.abs(actualDeltaY - dragDeltaY)).toBeLessThan(tolerance);

    console.log('OK Drag after zoom works correctly');
  });
});
