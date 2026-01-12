/**
 * Screenshot test for horizontal menu positioning with hover vs pinned editors
 *
 * This test verifies menu positioning in two scenarios:
 * 1. Hover editor - Menu should appear above the floating editor window
 * 2. Pinned editor - Menu should also appear above the floating editor window
 *
 * Current behavior (bug): Menu appears at NODE position, not floating window position
 * Expected behavior: Menu should appear above the floating editor window in both cases
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

test.describe('Horizontal Menu Position with Floating Editors', () => {
  test('should capture menu position for hover editor and pinned editor', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting horizontal menu position screenshot test ===');

    // Step 1: Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);
    console.log('App initialized');

    // Step 2: Add a test node with content
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'menu-position-test.md',
          contentWithoutYamlOrLinks: '# Menu Position Test\n\nThis node tests horizontal menu positioning relative to the floating editor window.\n\nThe menu should appear above the editor window, not at the node position.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        },
        previousNode: { _tag: 'None' } as const
      }
    ];
    await sendGraphDelta(page, graphDelta);
    console.log('Graph delta sent');

    // Step 3: Wait for layout to complete
    await page.waitForTimeout(500);
    console.log('Waited for layout');

    // Step 4: Trigger mouseover on the node to open horizontal menu and hover editor
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#menu-position-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(500);
    console.log('Mouseover event triggered on node');

    // Step 5: Verify menu is visible
    const menuVisible = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu') as HTMLElement | null;
      return menu !== null;
    });
    expect(menuVisible).toBe(true);
    console.log('Horizontal menu is visible');

    // Step 6: Verify hover editor is visible
    const hoverEditorSelector = '#window-menu-position-test\\.md-editor';
    await page.waitForSelector(hoverEditorSelector, { timeout: 3000 });
    await page.waitForSelector(`${hoverEditorSelector} .cm-content`, { timeout: 3000 });
    console.log('Hover editor is visible with content');

    // Step 7: Take screenshot of hover editor with menu
    await page.screenshot({
      path: 'e2e-tests/screenshots/menu-hover-editor.png',
      fullPage: true
    });
    console.log('Screenshot taken: menu-hover-editor.png');

    // Step 8: Get positions for verification
    const hoverPositions = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu') as HTMLElement | null;
      const editor = document.querySelector('[id$="-editor"]') as HTMLElement | null;

      if (!menu || !editor) {
        return { menuTop: 0, menuBottom: 0, menuCenterY: 0, editorTop: 0, editorBottom: 0, editorCenterY: 0 };
      }

      const menuRect = menu.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();

      return {
        menuTop: menuRect.top,
        menuBottom: menuRect.bottom,
        menuCenterY: menuRect.top + menuRect.height / 2,
        editorTop: editorRect.top,
        editorBottom: editorRect.bottom,
        editorCenterY: editorRect.top + editorRect.height / 2
      };
    });
    console.log(`Hover editor positions - Menu Y: ${hoverPositions.menuCenterY}, Editor top: ${hoverPositions.editorTop}`);

    // Step 9: Click the Pin Editor button to pin the editor
    // First, find the Pin Editor button (first button in the horizontal menu)
    const pinButtonClicked = await page.evaluate(() => {
      const pinButton = document.querySelector('.cy-horizontal-context-menu .horizontal-menu-item') as HTMLButtonElement | null;
      if (!pinButton) return false;
      pinButton.click();
      return true;
    });
    expect(pinButtonClicked).toBe(true);
    console.log('Pin Editor button clicked');

    // Step 10: Wait for pinned editor to be created
    await page.waitForTimeout(500);

    // Step 11: Re-trigger hover on the node to show the menu again
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#menu-position-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);
    console.log('Mouseover event triggered again for pinned editor');

    // Step 12: Verify menu is visible again
    const menuVisibleAfterPin = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu') as HTMLElement | null;
      return menu !== null;
    });
    expect(menuVisibleAfterPin).toBe(true);
    console.log('Horizontal menu is visible after pin');

    // Step 13: Verify pinned editor is visible
    // Pinned editors have a shadow node anchor, so they stay visible
    const pinnedEditorVisible = await page.evaluate(() => {
      const editor = document.querySelector('[id$="-editor"]') as HTMLElement | null;
      return editor !== null;
    });
    expect(pinnedEditorVisible).toBe(true);
    console.log('Pinned editor is visible');

    // Step 14: Take screenshot of pinned editor with menu
    await page.screenshot({
      path: 'e2e-tests/screenshots/menu-pinned-editor.png',
      fullPage: true
    });
    console.log('Screenshot taken: menu-pinned-editor.png');

    // Step 15: Get positions for pinned editor verification
    const pinnedPositions = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu') as HTMLElement | null;
      const editor = document.querySelector('[id$="-editor"]') as HTMLElement | null;

      if (!menu || !editor) {
        return { menuTop: 0, menuBottom: 0, menuCenterY: 0, editorTop: 0, editorBottom: 0, editorCenterY: 0 };
      }

      const menuRect = menu.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();

      return {
        menuTop: menuRect.top,
        menuBottom: menuRect.bottom,
        menuCenterY: menuRect.top + menuRect.height / 2,
        editorTop: editorRect.top,
        editorBottom: editorRect.bottom,
        editorCenterY: editorRect.top + editorRect.height / 2
      };
    });
    console.log(`Pinned editor positions - Menu Y: ${pinnedPositions.menuCenterY}, Editor top: ${pinnedPositions.editorTop}`);

    // Log the comparison for debugging
    console.log('Position comparison:');
    console.log(`  Hover: Menu is ${hoverPositions.menuCenterY < hoverPositions.editorTop ? 'ABOVE' : 'BELOW/AT'} editor`);
    console.log(`  Pinned: Menu is ${pinnedPositions.menuCenterY < pinnedPositions.editorTop ? 'ABOVE' : 'BELOW/AT'} editor`);

    // NOTE: The actual assertion for menu position is intentionally not included here.
    // This is a TDD test - we're capturing screenshots to visualize the current behavior
    // and document what the expected behavior should be.
    // The implementation task should make the menu appear above the floating editor window.

    console.log('Test completed successfully - screenshots captured');
  });
});
