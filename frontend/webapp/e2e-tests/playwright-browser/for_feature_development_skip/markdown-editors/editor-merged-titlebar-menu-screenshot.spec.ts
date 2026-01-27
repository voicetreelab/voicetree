/**
 * Screenshot test for floating editor with merged title bar and horizontal menu
 *
 * Verifies that the horizontal menu is embedded inside the title bar,
 * creating a unified draggable chrome with menu pills on the left
 * and window buttons (expand, fullscreen, close) on the right.
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  selectMockProject,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/pure/graph';

test.describe('Floating Editor Merged Title Bar with Menu', () => {
  test('should show horizontal menu embedded in title bar', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create a test node with some content
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'merged-titlebar-test.md',
          contentWithoutYamlOrLinks: '# Merged Title Bar Test\n\nThis editor should have the horizontal menu embedded in the title bar.\n\nThe menu pills should appear on the left, window buttons on the right.',
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
    await page.waitForTimeout(50);

    // Open editor via tap (creates anchored editor with menu)
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#merged-titlebar-test.md');
      if (node.length === 0) throw new Error('Node not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(100);

    // Wait for editor
    const editorSelector = '#window-merged-titlebar-test\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });

    // Verify the title bar has the menu class
    const titleBar = page.locator(`${editorSelector} .cy-floating-window-title`);
    await expect(titleBar).toBeVisible();

    // Check that title bar has the menu embedded
    const hasMenuClass = await page.evaluate((selector) => {
      const titleBarEl = document.querySelector(`${selector} .cy-floating-window-title`);
      return titleBarEl?.classList.contains('cy-floating-window-title-with-menu') ?? false;
    }, editorSelector);
    expect(hasMenuClass).toBe(true);

    // Verify menu wrapper exists inside title bar
    const menuWrapper = page.locator(`${editorSelector} .cy-floating-window-title-menu`);
    await expect(menuWrapper).toBeVisible();

    // Verify menu pills exist (leftGroup and rightGroup)
    const menuPills = page.locator(`${editorSelector} .cy-floating-window-title-menu .horizontal-menu-pill`);
    const pillCount = await menuPills.count();
    expect(pillCount).toBeGreaterThanOrEqual(2); // At least left and right pills

    // Verify window buttons still exist
    const buttonContainer = page.locator(`${editorSelector} .cy-floating-window-buttons`);
    await expect(buttonContainer).toBeVisible();

    // Take screenshot of just the title bar
    await titleBar.screenshot({
      path: 'e2e-tests/screenshots/editor-merged-titlebar-menu.png'
    });

    // Take screenshot of the whole editor window for context
    const editorWindow = page.locator(editorSelector);
    await editorWindow.screenshot({
      path: 'e2e-tests/screenshots/editor-merged-titlebar-full-window.png'
    });

    // Also take a full page screenshot for overall context
    await page.screenshot({
      path: 'e2e-tests/screenshots/editor-merged-titlebar-full-page.png',
      fullPage: true
    });
  });
});
