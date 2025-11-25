/**
 * Browser-based test for context menu close on mouse leave
 * Tests that the context menu closes when mouse moves away from the node after hovering
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
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

test.describe('Context Menu Close on Mouseout (Browser)', () => {
  test('should close context menu when mouse moves away from node', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting context menu mouseout test ===');

    // Step 1: Setup
    await setupMockElectronAPI(page);
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    await waitForCytoscapeReady(page);
    console.log('App initialized');

    // Step 2: Add a test node
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'context-menu-test-node.md',
          contentWithoutYamlOrLinks: '# Context Menu Test\nThis node tests context menu behavior.',
          outgoingEdges: [],
          nodeUIMetadata: {
            title: 'Context Menu Test',
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
            additionalYAMLProps: new Map(),
            isContextNode: false
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    console.log('Graph delta sent');

    // Step 3: Wait for layout to complete (Cola layout runs after node is added)
    await page.waitForFunction(() => {
      // Wait for layout complete log or a reasonable time
      return true;
    });
    await page.waitForTimeout(500); // Wait for Cola layout to complete
    console.log('Waited for layout');

    // Step 4: Get the FINAL node position after layout
    const { nodeX, nodeY, containerLeft, containerTop } = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#context-menu-test-node.md');
      if (node.length === 0) throw new Error('Node not found');
      const rp = node.renderedPosition();
      const container = cy.container();
      if (!container) throw new Error('Container not found');
      const rect = container.getBoundingClientRect();
      return {
        nodeX: rp.x,
        nodeY: rp.y,
        containerLeft: rect.left,
        containerTop: rect.top
      };
    });

    const absoluteX = containerLeft + nodeX;
    const absoluteY = containerTop + nodeY;
    console.log(`Node position: (${absoluteX}, ${absoluteY})`);

    // Step 5: Move mouse to node to trigger context menu
    await page.mouse.move(absoluteX, absoluteY);
    await page.waitForTimeout(300); // Give time for mouseover event to process
    console.log('Mouse moved to node');

    // Step 6: Check if context menu opened
    // cxtmenu shows the menu by setting display to non-'none' value
    const menuVisibleAfterHover = await page.evaluate(() => {
      const cxtmenus = document.querySelectorAll('.cxtmenu');
      for (let i = 0; i < cxtmenus.length; i++) {
        const menu = cxtmenus[i] as HTMLElement;
        // Menu is visible if display is not 'none' (could be 'block', '' or other)
        if (menu.style.display !== 'none' && menu.style.display !== '') {
          console.log('[Test] Menu visible with display:', menu.style.display);
          return true;
        }
      }
      // Also check computed style
      for (let i = 0; i < cxtmenus.length; i++) {
        const menu = cxtmenus[i] as HTMLElement;
        const computed = window.getComputedStyle(menu);
        if (computed.display !== 'none') {
          console.log('[Test] Menu visible (computed display):', computed.display);
          return true;
        }
      }
      return false;
    });
    console.log(`Menu visible after hover: ${menuVisibleAfterHover}`);
    expect(menuVisibleAfterHover).toBe(true);

    // Step 7: Move mouse away from node (to background)
    await page.mouse.move(absoluteX + 200, absoluteY + 200);
    await page.waitForTimeout(300);
    console.log('Mouse moved away from node');

    // Step 8: Verify menu closed
    const menuVisibleAfterMouseout = await page.evaluate(() => {
      const cxtmenus = document.querySelectorAll('.cxtmenu');
      for (let i = 0; i < cxtmenus.length; i++) {
        const menu = cxtmenus[i] as HTMLElement;
        // Menu is hidden if display is 'none' or empty string (default)
        if (menu.style.display !== 'none' && menu.style.display !== '') {
          return true;
        }
      }
      return false;
    });
    console.log(`Menu visible after mouseout: ${menuVisibleAfterMouseout}`);
    expect(menuVisibleAfterMouseout).toBe(false);

    console.log('Test completed successfully - context menu closes when mouse moves away from node');
  });
});
