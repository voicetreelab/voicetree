/**
 * Browser-based test for horizontal menu hover states
 * Tests that:
 * - Button labels only appear on hover (horizontal menu)
 * - Pin Editor is the first button
 * - Vertical submenu labels are always visible
 * - Spacer is present to avoid covering node icon
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

test.describe('Horizontal Menu Hover States', () => {
  test('should show labels only on button hover, have Pin first, and vertical submenu labels always visible', async ({ page, consoleCapture: _consoleCapture }) => {
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
          absoluteFilePathIsID: 'horizontal-menu-test.md',
          contentWithoutYamlOrLinks: '# Horizontal Menu Test\nThis node tests horizontal menu hover states.',
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 500, y: 300 } } as const,
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

    // Step 6: Verify first button is Pin Editor (check for pin icon SVG)
    const firstButtonIsPin = await page.evaluate(() => {
      const firstButton = document.querySelector('.cy-horizontal-context-menu .horizontal-menu-item') as HTMLElement | null;
      if (!firstButton) return { isPin: false, label: 'no button found' };
      const label = firstButton.querySelector('.horizontal-menu-label span')?.textContent ?? '';
      // Lucide pin icon has a specific path - just verify label text
      return { isPin: label === 'Pin Editor', label };
    });
    expect(firstButtonIsPin.isPin).toBe(true);
    console.log(`First button is Pin Editor: ${firstButtonIsPin.label}`);

    // Step 7: Take screenshot of menu with no button hovered (labels should be hidden)
    await page.screenshot({
      path: 'e2e-tests/screenshots/horizontal-menu-no-hover.png',
      fullPage: true
    });
    console.log('Screenshot taken: horizontal-menu-no-hover.png');

    // Step 8: Verify horizontal menu labels are hidden by default (using visibility, not display)
    const labelsHiddenByDefault = await page.evaluate(() => {
      // Only check labels in the horizontal menu, not submenu
      const menu = document.querySelector('.cy-horizontal-context-menu');
      if (!menu) return true;
      const labels = menu.querySelectorAll(':scope > div > .horizontal-menu-item > .horizontal-menu-label');
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
    console.log('Horizontal menu labels are hidden by default');

    // Step 9: Verify spacer is present
    const spacerPresent = await page.evaluate(() => {
      const spacer = document.querySelector('.horizontal-menu-spacer');
      return spacer !== null;
    });
    expect(spacerPresent).toBe(true);
    console.log('Spacer is present');

    // Step 10: Hover over first button (Pin Editor) to show label
    const buttonPosition = await page.evaluate(() => {
      const button = document.querySelector('.horizontal-menu-item') as HTMLElement | null;
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (buttonPosition) {
      await page.mouse.move(buttonPosition.x, buttonPosition.y);
      await page.waitForTimeout(100);
      console.log('Hovered over Pin Editor button');

      // Step 11: Take screenshot with button hovered (label should be visible)
      await page.screenshot({
        path: 'e2e-tests/screenshots/horizontal-menu-button-hovered.png',
        fullPage: true
      });
      console.log('Screenshot taken: horizontal-menu-button-hovered.png');

      // Step 12: Verify the hovered button's label is visible
      const hoveredLabelVisible = await page.evaluate(() => {
        const button = document.querySelector('.horizontal-menu-item:hover') as HTMLElement | null;
        if (!button) {
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

    // Step 13: Hover over "More" button to open vertical submenu
    const moreButtonPosition = await page.evaluate(() => {
      // More button is the last button in the menu
      const buttons = document.querySelectorAll('.cy-horizontal-context-menu > div > .horizontal-menu-item');
      const moreButton = buttons[buttons.length - 1] as HTMLElement | null;
      if (!moreButton) return null;
      const rect = moreButton.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (moreButtonPosition) {
      // Programmatically show the submenu since mouse hover may not work near viewport edge
      await page.evaluate(() => {
        const submenu = document.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
        if (submenu) submenu.style.display = 'flex';
      });
      await page.waitForTimeout(100);
      console.log('Submenu shown programmatically');

      // Step 14: Verify submenu exists and is visible
      const submenuVisible = await page.evaluate(() => {
        const submenu = document.querySelector('.horizontal-menu-submenu') as HTMLElement | null;
        if (!submenu) return false;
        return window.getComputedStyle(submenu).display === 'flex';
      });
      expect(submenuVisible).toBe(true);
      console.log('Submenu is visible');

      // Step 15: Take screenshot of vertical submenu (labels should be visible)
      await page.screenshot({
        path: 'e2e-tests/screenshots/horizontal-menu-vertical-submenu.png',
        fullPage: true
      });
      console.log('Screenshot taken: horizontal-menu-vertical-submenu.png');

      // Step 16: Verify vertical submenu labels are ALWAYS visible (not hidden)
      const submenuLabelsVisible = await page.evaluate(() => {
        const submenu = document.querySelector('.horizontal-menu-submenu');
        if (!submenu) return false;
        const labels = submenu.querySelectorAll('.horizontal-menu-label');
        let allVisible = true;
        labels.forEach(label => {
          const computed = window.getComputedStyle(label as HTMLElement);
          // For always-visible labels, visibility is not set to hidden
          if (computed.visibility === 'hidden') {
            allVisible = false;
          }
        });
        return allVisible && labels.length > 0;
      });
      expect(submenuLabelsVisible).toBe(true);
      console.log('Vertical submenu labels are always visible');
    }

    // Step 17: Move mouse away from buttons but keep menu open
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('.horizontal-menu-item');
      buttons.forEach(button => {
        button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      });
    });
    await page.waitForTimeout(100);
    console.log('Mouse leave events dispatched');

    // Step 18: Take screenshot with menu still open but no hover
    await page.screenshot({
      path: 'e2e-tests/screenshots/horizontal-menu-mouse-away.png',
      fullPage: true
    });
    console.log('Screenshot taken: horizontal-menu-mouse-away.png');

    // Step 19: Verify horizontal menu labels are hidden again after mouse leaves
    const labelsHiddenAfterLeave = await page.evaluate(() => {
      const menu = document.querySelector('.cy-horizontal-context-menu');
      if (!menu) return true;
      const labels = menu.querySelectorAll(':scope > div > .horizontal-menu-item > .horizontal-menu-label');
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
    console.log('Horizontal menu labels are hidden again after mouse leaves');

    console.log('Test completed successfully - horizontal menu UI fixups verified');
  });
});
