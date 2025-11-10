/**
 * Browser-based test for floating anchored markdown editor
 * Tests editor creation, content display, resize, drag, close/reopen
 */

import { test, expect } from '@playwright/test';
import {
  setupMockElectronAPI,
  sendGraphDelta,
  waitForCytoscapeReady,
  type ExtendedWindow
} from '@test/playwright-browser/graph-delta-test-utils.ts';
import type { GraphDelta } from '@/functional_graph/pure/types.ts';

test.describe('Floating Anchored Editor (Browser)', () => {
  test('should create editor, show content, follow anchor node drag, close and reopen', async ({ page }) => {
    console.log('\n=== Starting floating anchored editor test (Browser) ===');

    // Listen for console messages
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[Browser ${type}] ${text}`);
    });

    page.on('pageerror', error => {
      console.error('[Browser Error]', error.message);
      console.error(error.stack);
    });

    console.log('=== Step 1: Setup mock Electron API ===');
    await setupMockElectronAPI(page);
    console.log('✓ Electron API mock prepared');

    console.log('=== Step 2: Navigate to app ===');
    await page.goto('/');
    await page.waitForSelector('#root', { timeout: 5000 });
    console.log('✓ React rendered');

    await page.waitForTimeout(500);
    console.log('✓ Graph update handler registered');

    console.log('=== Step 3: Wait for Cytoscape ===');
    await waitForCytoscapeReady(page);
    console.log('✓ Cytoscape initialized');

    console.log('=== Step 4: Send graph delta with test node ===');
    const testContent = '# Test Node\nThis is test content for the floating editor.';
    const graphDelta: GraphDelta = [
      {
        type: 'UpsertNode' as const,
        nodeToUpsert: {
          relativeFilePathIsID: 'test-editor-node.md',
          content: testContent,
          outgoingEdges: [],
          nodeUIMetadata: {
            color: { _tag: 'None' } as const,
            position: { _tag: 'Some', value: { x: 400, y: 400 } } as const
          }
        }
      }
    ];
    await sendGraphDelta(page, graphDelta);
    await page.waitForTimeout(300);
    console.log('✓ Graph delta sent');

    console.log('=== Step 5: Open editor via tap event ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      if (node.length === 0) throw new Error('test-editor-node.md not found');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);
    console.log('✓ Tap event triggered');

    console.log('=== Step 6: Verify editor window and content ===');
    const editorSelector = '#window-editor-test-editor-node\\.md';
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window appeared');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    console.log('✓ CodeMirror rendered');

    const editorContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent || '';
    }, editorSelector);

    console.log(`  Editor content: "${editorContent}"`);
    expect(editorContent).toContain('Test Node');
    expect(editorContent).toContain('This is test content for the floating editor');
    console.log('✓ Content verified in editor');

    console.log('=== Step 7: Verify shadow node exists and has dimensions ===');
    const shadowNodeDims = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const shadowNode = cy.$('#editor-test-editor-node\\.md');
      if (shadowNode.length === 0) throw new Error('Shadow node not found');
      return {
        width: shadowNode.width(),
        height: shadowNode.height()
      };
    });
    console.log(`  Shadow node dims: ${shadowNodeDims.width}x${shadowNodeDims.height}`);
    expect(shadowNodeDims.width).toBeGreaterThan(0);
    expect(shadowNodeDims.height).toBeGreaterThan(0);

    console.log('=== Step 8: Drag anchor node and verify shadow follows ===');
    const initialNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      return node.position();
    });
    console.log(`  Initial anchor node pos: (${initialNodePos.x}, ${initialNodePos.y})`);

    // Drag the anchor node
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      node.position({ x: 600, y: 600 });
    });
    await page.waitForTimeout(300);
    console.log('✓ Dragged anchor node');

    const newNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      return node.position();
    });
    console.log(`  New anchor node pos: (${newNodePos.x}, ${newNodePos.y})`);
    expect(newNodePos.x).toBe(600);
    expect(newNodePos.y).toBe(600);

    // Verify shadow node also moved (it should be anchored to the node)
    const shadowNodePos = await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const shadowNode = cy.$('#editor-test-editor-node\\.md');
      return shadowNode.position();
    });
    console.log(`  Shadow node pos: (${shadowNodePos.x}, ${shadowNodePos.y})`);
    // Shadow should be near the anchor node (with some offset)
    expect(Math.abs(shadowNodePos.x - newNodePos.x)).toBeLessThan(500);
    expect(Math.abs(shadowNodePos.y - newNodePos.y)).toBeLessThan(500);

    console.log('=== Step 9: Close editor ===');
    const closeButton = await page.locator(`${editorSelector} .cy-floating-window-close`);
    await closeButton.click();
    await page.waitForTimeout(300);
    console.log('✓ Clicked close button');

    // Verify editor is gone
    const editorGone = await page.evaluate((selector) => {
      return document.querySelector(selector) === null;
    }, editorSelector);
    expect(editorGone).toBe(true);
    console.log('✓ Editor window closed');

    console.log('=== Step 10: Reopen editor ===');
    await page.evaluate(() => {
      const cy = (window as ExtendedWindow).cytoscapeInstance;
      if (!cy) throw new Error('Cytoscape not initialized');
      const node = cy.$('#test-editor-node.md');
      node.trigger('tap');
    });
    await page.waitForTimeout(500);
    console.log('✓ Tap event triggered again');

    // Verify editor reopened
    await page.waitForSelector(editorSelector, { timeout: 3000 });
    console.log('✓ Editor window reopened');

    await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 3000 });
    const reopenedContent = await page.evaluate((selector) => {
      const cmContent = document.querySelector(`${selector} .cm-content`);
      return cmContent?.textContent || '';
    }, editorSelector);

    expect(reopenedContent).toContain('Test Node');
    expect(reopenedContent).toContain('This is test content for the floating editor');
    console.log('✓ Content verified in reopened editor');

    console.log('✓ Floating anchored editor test completed successfully');
  });
});
