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

    // Step 3: Wait for layout to complete
    await page.waitForTimeout(500); // Wait for Cola layout to complete
    console.log('Waited for layout');

    // Step 4: Trigger mouseover on the node using Cytoscape events
    // This is the correct way to trigger the radial menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#context-menu-test-node.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300); // Give time for mouseover event to process
    console.log('Mouseover event triggered on node');

    // Step 5: Check if context menu opened
    // The horizontal menu uses .ctxmenu element (note: ctxmenu, not cxtmenu)
    const menuVisibleAfterHover = await page.evaluate(() => {
      const menu = document.querySelector('.ctxmenu') as HTMLElement | null;
      if (!menu) {
        console.log('[Test] No .ctxmenu element found');
        return false;
      }
      const computed = window.getComputedStyle(menu);
      const isVisible = computed.display !== 'none';
      console.log('[Test] Menu display:', computed.display, 'visible:', isVisible);
      return isVisible;
    });
    console.log(`Menu visible after hover: ${menuVisibleAfterHover}`);
    expect(menuVisibleAfterHover).toBe(true);

    // Step 6: Trigger mouseover on background (cy itself) to close menu
    // This simulates moving mouse away from the node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      // Emit mouseover on the cy instance itself (background)
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      cy.emit('mouseover', { target: cy } as any);
    });
    await page.waitForTimeout(300);
    console.log('Mouseover event triggered on background');

    // Step 7: Verify menu closed
    const menuVisibleAfterMouseout = await page.evaluate(() => {
      const menu = document.querySelector('.ctxmenu') as HTMLElement | null;
      if (!menu) {
        console.log('[Test] No .ctxmenu element found after mouseout');
        return false;
      }
      const computed = window.getComputedStyle(menu);
      const isVisible = computed.display !== 'none';
      console.log('[Test] Menu display after mouseout:', computed.display, 'visible:', isVisible);
      return isVisible;
    });
    console.log(`Menu visible after mouseout: ${menuVisibleAfterMouseout}`);
    expect(menuVisibleAfterMouseout).toBe(false);

    console.log('Test completed successfully - context menu closes when mouse moves away from node');
  });
});
