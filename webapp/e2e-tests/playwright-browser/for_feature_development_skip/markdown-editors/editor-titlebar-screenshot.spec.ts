/**
 * Screenshot test for floating editor title bar
 * Verifies compact title bar with icons next to each other
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

test.describe('Floating Editor Title Bar Screenshot', () => {
  test('should show compact title bar with icons', async ({ page }) => {
    await setupMockElectronAPI(page);
    await page.goto('/');
    await selectMockProject(page);
    await page.waitForSelector('#root', { timeout: 5000 });
    await page.waitForTimeout(50);
    await waitForCytoscapeReady(page);

    // Create a test node
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          absoluteFilePathIsID: 'screenshot-test-node.md',
          contentWithoutYamlOrLinks: '# Screenshot Test\nContent here.',
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
    await page.waitForTimeout(30);

    // Open editor via tap
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#screenshot-test-node.md');
      if (node.length === 0) throw new Error('Node not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(100);

    // Wait for editor
    const editorSelector = '#window-screenshot-test-node\\.md-editor';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });

    // Take screenshot of the title bar
    const titleBar = page.locator(`${editorSelector} .cy-floating-window-title`);
    await expect(titleBar).toBeVisible();

    await titleBar.screenshot({
      path: 'e2e-tests/screenshots/editor-titlebar-compact.png'
    });

    // Also take a screenshot of the whole editor window
    const editorWindow = page.locator(editorSelector);
    await editorWindow.screenshot({
      path: 'e2e-tests/screenshots/editor-window-compact.png'
    });
  });
});
