/**
 * Browser-based tests for floating window pin/hover menu behaviors
 * Tests pin button functionality for hover and anchored editors
 */

import { test as base, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils';
import type { GraphDelta } from '@/pure/graph';

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

test.describe('Traffic Light Pin Behaviors (Browser)', () => {

  test.describe('Node Hover Menu', () => {
    // Cytoscape's internal hit detection doesn't fire from page.mouse.move in headless Chromium.
    // Hover menu requires cytoscape mouseover event which needs canvas-level hit testing.
    test.fixme('should show hover menu with node in gap between pills (no duplicate menu in editor)', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting node hover menu test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'hover-menu-test-node.md',
            contentWithoutYamlOrLinks: '# Hover Menu Test\nTest content for hover menu.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 300 } } as const,
              additionalYAMLProps: {},
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(50);
      console.log('OK Graph delta sent');

      // Move actual mouse over the node's rendered position to trigger hover
      console.log('=== Moving mouse over node to trigger hover ===');
      const nodeScreenPos = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#hover-menu-test-node.md');
        if (node.length === 0) throw new Error('hover-menu-test-node.md not found');
        const rpos = node.renderedPosition();
        const container = cy.container();
        if (!container) throw new Error('No cy container');
        const rect = container.getBoundingClientRect();
        return { x: rect.left + rpos.x, y: rect.top + rpos.y };
      });
      await page.mouse.move(nodeScreenPos.x, nodeScreenPos.y);
      await page.waitForTimeout(300);

      // Wait for hover menu from HorizontalMenuService (has node in gap between pills)
      const hoverMenuSelector = '.cy-horizontal-context-menu';
      await page.waitForSelector(hoverMenuSelector, { timeout: 3000 });
      console.log('OK Hover menu appeared');

      // Also verify hover editor appeared
      const editorSelector = '#window-hover-menu-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Hover editor appeared');

      // Check menu configuration
      const menuInfo = await page.evaluate(({ hoverMenuSel, editorSel }: { hoverMenuSel: string, editorSel: string }) => {
        const hoverMenu = document.querySelector(hoverMenuSel);
        const editorWindow = document.querySelector(editorSel);

        return {
          hoverMenuExists: hoverMenu !== null,
          hoverMenuHasPin: hoverMenu?.querySelector('.traffic-light-pin') !== null,
          hoverMenuHasFullscreen: hoverMenu?.querySelector('.traffic-light-fullscreen') !== null,
          hoverMenuHasClose: hoverMenu?.querySelector('.traffic-light-close') !== null,
          editorExists: editorWindow !== null,
          editorHasOwnMenu: editorWindow?.querySelector('.cy-floating-window-horizontal-menu') !== null,
          totalHoverMenus: document.querySelectorAll('.cy-horizontal-context-menu').length,
          totalEditorMenus: document.querySelectorAll('.cy-floating-window-horizontal-menu').length
        };
      }, { hoverMenuSel: hoverMenuSelector, editorSel: editorSelector });

      console.log(`Menu info: hoverMenu=${menuInfo.hoverMenuExists}, hasPin=${menuInfo.hoverMenuHasPin}, editorHasMenu=${menuInfo.editorHasOwnMenu}`);

      // Verify hover menu exists and has traffic lights
      expect(menuInfo.hoverMenuExists).toBe(true);
      expect(menuInfo.hoverMenuHasPin).toBe(true);
      expect(menuInfo.hoverMenuHasFullscreen).toBe(true);
      expect(menuInfo.hoverMenuHasClose).toBe(true);
      console.log('OK Hover menu has traffic lights');

      // Verify hover editor does NOT have its own menu (would cause duplication)
      expect(menuInfo.editorHasOwnMenu).toBe(false);
      console.log('OK Hover editor does not have its own menu (no duplication)');

      // Verify only 1 hover menu exists
      expect(menuInfo.totalHoverMenus).toBe(1);
      expect(menuInfo.totalEditorMenus).toBe(0);
      console.log('OK Only one menu exists (hover menu, not editor chrome menu)');

      // Take screenshot
      await page.screenshot({ path: 'e2e-tests/screenshots/node-hover-menu.png', fullPage: true });
      console.log('OK Screenshot taken');

      console.log('OK Node hover menu test completed');
    });
  });

  test.describe('Pin Button on Hover Editor', () => {
    // Same issue as hover menu test: cytoscape mouseover not triggered by page.mouse.move
    test.fixme('should convert hover editor to anchored editor when pin button is clicked', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting pin hover editor test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'pin-test-node.md',
            contentWithoutYamlOrLinks: '# Pin Test\nTest content for pin behavior.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
              additionalYAMLProps: {},
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(30);
      console.log('OK Graph delta sent');

      // Move actual mouse over the node's rendered position to trigger hover
      console.log('=== Moving mouse over node to trigger hover ===');
      const nodeScreenPos = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#pin-test-node.md');
        if (node.length === 0) throw new Error('pin-test-node.md not found');
        const rpos = node.renderedPosition();
        const container = cy.container();
        if (!container) throw new Error('No cy container');
        const rect = container.getBoundingClientRect();
        return { x: rect.left + rpos.x, y: rect.top + rpos.y };
      });
      await page.mouse.move(nodeScreenPos.x, nodeScreenPos.y);
      await page.waitForTimeout(300);

      // Wait for hover editor to appear
      const editorSelector = '#window-pin-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Hover editor appeared');

      // Verify no shadow node exists yet (hover editor is not anchored)
      const shadowNodeExistsBefore = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.$('#pin-test-node\\.md-editor-anchor-shadowNode');
        return shadowNode.length > 0;
      });
      expect(shadowNodeExistsBefore).toBe(false);
      console.log('OK No shadow node before pinning (hover editor)');

      // Wait for hover menu to appear (has the pin button)
      const hoverMenuSelector = '.cy-horizontal-context-menu';
      await page.waitForSelector(hoverMenuSelector, { timeout: 3000 });
      console.log('OK Hover menu appeared');

      // Find and click the pin button in the hover menu using real mouse events
      console.log('=== Clicking pin button in hover menu ===');
      const pinButtonSelector = '.cy-horizontal-context-menu .traffic-light-pin';
      const pinButton = page.locator(pinButtonSelector);
      await expect(pinButton).toBeVisible();
      await pinButton.click();
      console.log('OK Pin button clicked');
      await page.waitForTimeout(200);

      // Verify shadow node now exists (editor converted to anchored)
      const shadowNodeExistsAfter = await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) return false;
        const shadowNode = cy.$('#pin-test-node\\.md-editor-anchor-shadowNode');
        return shadowNode.length > 0;
      });
      expect(shadowNodeExistsAfter).toBe(true);
      console.log('OK Shadow node created after pinning');

      // Take screenshot for verification
      await page.screenshot({ path: 'e2e-tests/screenshots/pin-hover-editor-after.png', fullPage: false });
      console.log('OK Screenshot taken');

      console.log('OK Pin hover editor test completed');
    });
  });

  test.describe('Pin Button Visual State', () => {
    test('should show correct visual states for unpinned and pinned (anchored editor)', async ({ page, consoleCapture: _consoleCapture }) => {
      console.log('\n=== Starting pin visual state test ===');

      await setupMockElectronAPI(page);
      await page.goto('/');
      await waitForCytoscapeReady(page);

      // Create test node
      const graphDelta: GraphDelta = [
        {
          type: 'UpsertNode' as const,
          nodeToUpsert: {
            absoluteFilePathIsID: 'pin-visual-test-node.md',
            contentWithoutYamlOrLinks: '# Pin Visual Test\nTest content for pin visual state.',
            outgoingEdges: [],
            nodeUIMetadata: {
              color: { _tag: 'None' } as const,
              position: { _tag: 'Some', value: { x: 400, y: 400 } } as const,
              additionalYAMLProps: {},
              isContextNode: false
            }
          },
          previousNode: { _tag: 'None' } as const
        }
      ];
      await sendGraphDelta(page, graphDelta);
      await page.waitForTimeout(30);
      console.log('OK Graph delta sent');

      // Open anchored editor via tap
      console.log('=== Opening anchored editor via tap ===');
      await page.evaluate(() => {
        const cy = (window as ExtendedWindow).cytoscapeInstance;
        if (!cy) throw new Error('Cytoscape not initialized');
        const node = cy.$('#pin-visual-test-node.md');
        if (node.length === 0) throw new Error('pin-visual-test-node.md not found');
        node.trigger('tap');
      });
      await page.waitForTimeout(100);

      const editorSelector = '#window-pin-visual-test-node\\.md-editor';
      await page.waitForSelector(editorSelector, { timeout: 3000 });
      console.log('OK Anchored editor appeared');

      // Verify pin button exists and is initially unpinned
      const initialPinState = await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return { found: false, hasPinnedClass: false };
        const pinButton = editorWindow.querySelector('.traffic-light-pin') as HTMLButtonElement;
        if (!pinButton) return { found: false, hasPinnedClass: false };
        return {
          found: true,
          hasPinnedClass: pinButton.classList.contains('pinned')
        };
      }, editorSelector);

      expect(initialPinState.found).toBe(true);
      expect(initialPinState.hasPinnedClass).toBe(false);
      console.log('OK Pin button found in unpinned state');

      // Take screenshot of unpinned state
      await page.screenshot({ path: 'e2e-tests/screenshots/pin-visual-state-unpinned.png', fullPage: false });
      console.log('OK Screenshot of unpinned state taken');

      // Click pin button to toggle to pinned state
      console.log('=== Clicking pin button to toggle to pinned state ===');
      await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return;
        const pinButton = editorWindow.querySelector('.traffic-light-pin') as HTMLButtonElement;
        if (pinButton) pinButton.click();
      }, editorSelector);
      await page.waitForTimeout(200);

      // Verify pin button is now pinned
      const afterPinState = await page.evaluate((selector) => {
        const editorWindow = document.querySelector(selector);
        if (!editorWindow) return { found: false, hasPinnedClass: false };
        const pinButton = editorWindow.querySelector('.traffic-light-pin') as HTMLButtonElement;
        if (!pinButton) return { found: false, hasPinnedClass: false };
        return {
          found: true,
          hasPinnedClass: pinButton.classList.contains('pinned')
        };
      }, editorSelector);

      expect(afterPinState.found).toBe(true);
      expect(afterPinState.hasPinnedClass).toBe(true);
      console.log('OK Pin button now has pinned class');

      // Take screenshot of pinned state
      await page.screenshot({ path: 'e2e-tests/screenshots/pin-visual-state-pinned.png', fullPage: false });
      console.log('OK Screenshot of pinned state taken');

      console.log('OK Pin visual state test completed');
    });
  });
});
