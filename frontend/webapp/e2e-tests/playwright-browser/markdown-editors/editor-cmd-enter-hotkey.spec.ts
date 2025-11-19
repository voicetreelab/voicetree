/**
 * Browser-based test for Cmd+Enter hotkey in hover editor
 * Tests that pressing Cmd+Enter inside an editor opens a terminal
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@e2e/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/pure/graph';

test.describe('Editor Cmd+Enter Hotkey (Browser)', () => {
  test('should open terminal when pressing Cmd+Enter inside hover editor', async ({ page }) => {
    console.log('\n=== Starting Editor Cmd+Enter test (Browser) ===');

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(50);

    console.log('=== Step 3: Wait for Cytoscape ready ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape ready');

    console.log('=== Step 4: Send graph delta with test node ===');
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'test-node-1.md',
          content: 'Test content\n\nPress Cmd+Enter to run terminal',
          outgoingEdges: [],
          nodeUIMetadata: {
            title: 'Test Node',
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 300, y: 300 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(30);
    console.log('✓ Test node created');

    console.log('=== Step 5: Hover over node to open editor ===');
    // Trigger hover on the node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-node-1.md');
      if (node.length === 0) throw new Error('test-node-1.md not found');
      node.trigger('mouseover');
    });

    // Wait for hover editor to appear
    await page.waitForSelector('.cy-floating-window', { timeout: 5000 });
    console.log('✓ Hover editor appeared');

    // Wait for editor content to load
    await page.waitForTimeout(500);

    console.log('=== Step 6: Focus editor and press Cmd+Enter ===');
    // Click inside the editor to focus it
    const editorContent = page.locator('.cy-floating-window .cm-content');
    await editorContent.click();
    await page.waitForTimeout(100);

    // Press Cmd+Enter inside the editor
    await editorContent.press('Meta+Enter');
    console.log('✓ Pressed Cmd+Enter inside editor');

    console.log('=== Step 7: Verify terminal window was created ===');
    // Wait for terminal window to appear
    const terminalWindow = page.locator('[data-shadow-node-relativeFilePathIsID^="terminal-"]');
    await expect(terminalWindow).toBeVisible({ timeout: 5000 });
    console.log('✓ Terminal window appeared');

    // Verify terminal title contains the node name
    const terminalTitle = terminalWindow.locator('.cy-floating-window-title-text');
    const titleText = await terminalTitle.textContent();
    expect(titleText).toContain('Terminal');
    console.log(`✓ Terminal title: ${titleText}`);

    console.log('\n=== Test completed successfully! ===');
  });
});
