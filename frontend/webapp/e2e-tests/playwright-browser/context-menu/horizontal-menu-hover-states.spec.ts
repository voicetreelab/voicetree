/**
 * Browser-based test for horizontal menu hover states
 * Tests that button labels only appear on hover and that the spacer is present
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.js';
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

test.describe('Horizontal Menu Hover States', () => {
  test('should show labels only on button hover and have spacer', async ({ page, consoleCapture: _consoleCapture }) => {
    console.log('\n=== Starting horizontal menu hover states test ===');

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
          relativeFilePathIsID: 'horizontal-menu-test.md',
          contentWithoutYamlOrLinks: '# Horizontal Menu Test\nThis node tests horizontal menu hover states.',
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

    // Step 4: Trigger mouseover on the node to open horizontal menu
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#horizontal-menu-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.emit('mouseover');
    });
    await page.waitForTimeout(300);
    console.log('Mouseover event triggered on node');

    // Step 5: Verify menu is visible
    const menuVisible = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu') as HTMLElement | null;
      return menu !== null;
    });
    expect(menuVisible).toBe(true);
    console.log('Menu is visible');

    // Step 6: Take screenshot of menu with no button hovered (labels should be hidden)
    await page.screenshot({
      path: 'e2e-tests/screenshots/horizontal-menu-no-hover.png',
      fullPage: true
    });
    console.log('Screenshot taken: horizontal-menu-no-hover.png');

    // Step 7: Verify labels are hidden by default (using visibility, not display)
    const labelsHiddenByDefault = await page.evaluate(() => {
      const labels = document.querySelectorAll('.horizontal-menu-label');
      let allHidden = true;
      labels.forEach(label => {
        const computed = window.getComputedStyle(label as HTMLElement);
        if (computed.visibility !== 'hidden') {
          allHidden = false;
        }
      });
      return allHidden;
    });
    expect(labelsHiddenByDefault).toBe(true);
    console.log('Labels are hidden by default');

    // Step 8: Verify spacer is present
    const spacerPresent = await page.evaluate(() => {
      const spacer = document.querySelector('.horizontal-menu-spacer');
      return spacer !== null;
    });
    expect(spacerPresent).toBe(true);
    console.log('Spacer is present');

    // Step 9: Hover over a menu button to show label
    // Get the position of the first menu button
    const buttonPosition = await page.evaluate(() => {
      const button = document.querySelector('.horizontal-menu-item') as HTMLElement | null;
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (buttonPosition) {
      await page.mouse.move(buttonPosition.x, buttonPosition.y);
      await page.waitForTimeout(100);
      console.log('Hovered over menu button');

      // Step 10: Take screenshot with button hovered (label should be visible)
      await page.screenshot({
        path: 'e2e-tests/screenshots/horizontal-menu-button-hovered.png',
        fullPage: true
      });
      console.log('Screenshot taken: horizontal-menu-button-hovered.png');

      // Step 11: Verify the hovered button's label is visible (using visibility, not display)
      const hoveredLabelVisible = await page.evaluate(() => {
        const button = document.querySelector('.horizontal-menu-item:hover') as HTMLElement | null;
        if (!button) {
          // Fallback: check if any label is visible
          const labels = document.querySelectorAll('.horizontal-menu-label');
          let anyVisible = false;
          labels.forEach(label => {
            const computed = window.getComputedStyle(label as HTMLElement);
            if (computed.visibility === 'visible') {
              anyVisible = true;
            }
          });
          return anyVisible;
        }
        const label = button.querySelector('.horizontal-menu-label') as HTMLElement | null;
        if (!label) return false;
        const computed = window.getComputedStyle(label);
        return computed.visibility === 'visible';
      });
      expect(hoveredLabelVisible).toBe(true);
      console.log('Hovered button label is visible');
    }

    // Step 12: Move mouse away from buttons but keep menu open
    // Note: Playwright's mouse.move() doesn't properly trigger mouseleave events,
    // so we use dispatchEvent to simulate the real browser behavior
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('.horizontal-menu-item');
      buttons.forEach(button => {
        button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      });
    });
    await page.waitForTimeout(100);
    console.log('Mouse leave events dispatched');

    // Step 13: Take screenshot with menu still open but no hover
    await page.screenshot({
      path: 'e2e-tests/screenshots/horizontal-menu-mouse-away.png',
      fullPage: true
    });
    console.log('Screenshot taken: horizontal-menu-mouse-away.png');

    // Step 14: Verify labels are hidden again after mouse leaves (using visibility, not display)
    const labelsHiddenAfterLeave = await page.evaluate(() => {
      const labels = document.querySelectorAll('.horizontal-menu-label');
      let allHidden = true;
      labels.forEach(label => {
        const computed = window.getComputedStyle(label as HTMLElement);
        if (computed.visibility !== 'hidden') {
          allHidden = false;
        }
      });
      return allHidden;
    });
    expect(labelsHiddenAfterLeave).toBe(true);
    console.log('Labels are hidden again after mouse leaves');

    console.log('Test completed successfully - horizontal menu hover states work correctly');
  });
});
